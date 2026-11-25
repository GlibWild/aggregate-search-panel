/**
 * 面板根组件：数据加载、事件同步、登录轮询与各类操作。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOGIN_POLL_INTERVAL_MS } from '../shared/constants';
import {
  isEventMessage,
  sendRequest,
  type SearchRunResult,
  type SessionCheckResult,
  type VaultStatusResult,
} from '../shared/messages';
import type {
  AppSnapshot,
  LoginFlowState,
  Settings,
  SiteConfig,
  SiteDraft,
  SiteSession,
  SiteSessionDiagnosis,
} from '../shared/types';
import { pushHistory } from '../shared/search-utils';
import { SearchView, type SearchState } from './components/SearchView';
import { SitesView } from './components/SitesView';
import { SettingsView } from './components/SettingsView';
import { SiteEditor } from './components/SiteEditor';
import { DiagnosisModal } from './components/DiagnosisModal';
import { EmptyState, Icon, Modal, Spinner, Toast } from './components/Ui';
import {
  downloadText,
  errorText,
  querySitePermission,
  requestSitePermission,
} from './utils';

type TabKey = 'search' | 'sites' | 'settings';
type ToastLevel = 'info' | 'success' | 'warn' | 'error';

interface ToastState {
  id: number;
  level: ToastLevel;
  message: string;
}

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [flows, setFlows] = useState<Record<string, LoginFlowState>>({});
  const [tab, setTab] = useState<TabKey>('search');
  const [keyword, setKeyword] = useState('');
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [vaults, setVaults] = useState<Record<string, VaultStatusResult>>({});
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; site?: SiteConfig } | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importReplace, setImportReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [diagnosisSiteId, setDiagnosisSiteId] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<SiteSessionDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [fixingCookies, setFixingCookies] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((level: ToastLevel, message: string) => {
    setToast({ id: Date.now(), level, message });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3_600);
  }, []);

  const refreshGranted = useCallback(async (sites: SiteConfig[]) => {
    const entries = await Promise.all(
      sites.map(async (site) => [site.id, await querySitePermission(site.origins)] as const),
    );
    setGranted(Object.fromEntries(entries));
  }, []);

  const refreshVaults = useCallback(async (sites: SiteConfig[]) => {
    const entries = await Promise.all(
      sites.map(async (site) => {
        try {
          const status = await sendRequest<VaultStatusResult>({ type: 'vault:status', siteId: site.id });
          return [site.id, status] as const;
        } catch {
          return [site.id, { siteId: site.id, hasBackup: false } as VaultStatusResult] as const;
        }
      }),
    );
    setVaults(Object.fromEntries(entries));
  }, []);

  /** 主动检测全部站点：浏览器中已登录的站点会立即显示为“已登录”。 */
  const refreshSessions = useCallback(async () => {
    try {
      const result = await sendRequest<SessionCheckResult>({ type: 'sessions:check' });
      setSnapshot((prev) =>
        prev ? { ...prev, sessions: { ...prev.sessions, ...result.sessions } } : prev,
      );
    } catch {
      // 静默失败，用户仍可在站点卡片上手动检测。
    }
  }, []);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sendRequest<AppSnapshot>({ type: 'app:snapshot' });
      setSnapshot(data);
      setFlows(data.flows);
      setSelectedSiteIds(data.sites.filter((site) => site.enabled).map((site) => site.id));
      setFatal(null);
      void refreshGranted(data.sites);
      void refreshVaults(data.sites);
      void refreshSessions();
    } catch (error) {
      setFatal(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [refreshGranted, refreshVaults, refreshSessions]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  // ---------- 后台事件 ----------
  useEffect(() => {
    const listener = (message: unknown): void => {
      if (!isEventMessage(message)) {
        return;
      }
      const event = message.event;
      switch (event.kind) {
        case 'session-updated':
          setSnapshot((prev) =>
            prev
              ? {
                  ...prev,
                  sessions: { ...prev.sessions, [event.session.siteId]: event.session },
                }
              : prev,
          );
          break;
        case 'sites-updated':
          setSnapshot((prev) => (prev ? { ...prev, sites: event.sites } : prev));
          setSelectedSiteIds((prev) =>
            prev.filter((siteId) => event.sites.some((site) => site.id === siteId && site.enabled)),
          );
          void refreshGranted(event.sites);
          void refreshVaults(event.sites);
          break;
        case 'login-state':
          setFlows((prev) => ({ ...prev, [event.state.siteId]: event.state }));
          if (event.state.status === 'success') {
            showToast('success', `${event.state.siteName} 登录成功`);
          }
          break;
        case 'search-progress':
          setSearch((prev) => {
            if (!prev || prev.requestId !== event.requestId) {
              return prev;
            }
            return { ...prev, progress: { ...prev.progress, [event.siteId]: event.phase } };
          });
          break;
        case 'search-outcome':
          setSearch((prev) => {
            if (!prev || prev.requestId !== event.requestId) {
              return prev;
            }
            return {
              ...prev,
              outcomes: { ...prev.outcomes, [event.outcome.siteId]: event.outcome },
            };
          });
          break;
        case 'search-done':
          setSearch((prev) => {
            if (!prev || prev.requestId !== event.requestId) {
              return prev;
            }
            return { ...prev, running: false };
          });
          break;
        case 'toast':
          showToast(event.level, event.message);
          break;
        default:
          break;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshGranted, refreshVaults, showToast]);

  // ---------- 登录轮询 ----------
  const activeFlowKey = useMemo(
    () =>
      Object.values(flows)
        .filter((flow) => ['starting', 'waiting', 'qr-missing'].includes(flow.status))
        .map((flow) => flow.siteId)
        .sort()
        .join('|'),
    [flows],
  );

  useEffect(() => {
    if (!activeFlowKey) {
      return;
    }
    const siteIds = activeFlowKey.split('|').filter(Boolean);
    let cancelled = false;

    const tick = async (): Promise<void> => {
      for (const siteId of siteIds) {
        if (cancelled) {
          return;
        }
        try {
          const state = await sendRequest<LoginFlowState>({ type: 'login:poll', siteId });
          if (cancelled) {
            return;
          }
          setFlows((prev) => ({ ...prev, [siteId]: state }));
        } catch {
          // 登录窗口可能已关闭，等待下一次事件或用户手动刷新。
        }
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), LOGIN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeFlowKey]);

  const sites = snapshot?.sites ?? [];
  const sessions = snapshot?.sessions ?? {};
  const settings = snapshot?.settings;

  const enabledSites = useMemo(() => sites.filter((site) => site.enabled), [sites]);

  const setSiteBusy = useCallback((siteId: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [siteId]: value }));
  }, []);

  const ensurePermission = useCallback(
    async (site: SiteConfig): Promise<boolean> => {
      const grantedNow = await requestSitePermission(site.origins);
      setGranted((prev) => ({ ...prev, [site.id]: grantedNow }));
      return grantedNow;
    },
    [],
  );

  // ---------- 登录操作 ----------
  const handleLogin = useCallback(
    async (siteId: string) => {
      const site = sites.find((item) => item.id === siteId);
      if (!site) {
        return;
      }
      setTab('sites');
      setSiteBusy(siteId, true);
      try {
        if (!(await ensurePermission(site))) {
          showToast('warn', '未授权访问该站点，无法打开登录页');
          return;
        }
        const state = await sendRequest<LoginFlowState>({ type: 'login:start', siteId });
        setFlows((prev) => ({ ...prev, [siteId]: state }));
      } catch (error) {
        showToast('error', errorText(error));
      } finally {
        setSiteBusy(siteId, false);
      }
    },
    [ensurePermission, setSiteBusy, showToast, sites],
  );

  const handleCancelLogin = useCallback(
    async (siteId: string) => {
      try {
        await sendRequest({ type: 'login:cancel', siteId });
        setFlows((prev) => {
          const current = prev[siteId];
          return current ? { ...prev, [siteId]: { ...current, status: 'closed', qr: undefined } } : prev;
        });
      } catch (error) {
        showToast('error', errorText(error));
      }
    },
    [showToast],
  );

  const handleRefreshQr = useCallback(
    async (siteId: string) => {
      setSiteBusy(siteId, true);
      try {
        const state = await sendRequest<LoginFlowState>({ type: 'login:refresh', siteId });
        setFlows((prev) => ({ ...prev, [siteId]: state }));
      } catch (error) {
        showToast('error', errorText(error));
      } finally {
        setSiteBusy(siteId, false);
      }
    },
    [setSiteBusy, showToast],
  );

  const handleFocusLogin = useCallback(
    async (siteId: string) => {
      try {
        await sendRequest({ type: 'login:focus', siteId });
      } catch (error) {
        showToast('warn', errorText(error));
      }
    },
    [showToast],
  );

  /** 打开登录态诊断，展示权限、Cookie 名称与自动识别结果。 */
  const openDiagnosis = useCallback(
    async (siteId: string) => {
      setDiagnosisSiteId(siteId);
      setDiagnosisLoading(true);
      try {
        const data = await sendRequest<SiteSessionDiagnosis>({ type: 'sessions:diagnose', siteId });
        setDiagnosis(data);
      } catch (error) {
        showToast('error', errorText(error));
      } finally {
        setDiagnosisLoading(false);
      }
    },
    [showToast],
  );

  const closeDiagnosis = useCallback(() => {
    setDiagnosisSiteId(null);
    setDiagnosis(null);
  }, []);

  const handleFixCookies = useCallback(
    async (cookieNames: string[]) => {
      const siteId = diagnosis?.siteId;
      if (!siteId || cookieNames.length === 0) {
        return;
      }
      setFixingCookies(true);
      try {
        const site = await sendRequest<SiteConfig>({
          type: 'sites:set-session-cookies',
          siteId,
          cookieNames,
        });
        setSnapshot((prev) =>
          prev
            ? { ...prev, sites: prev.sites.map((item) => (item.id === site.id ? site : item)) }
            : prev,
        );
        showToast('success', `关键 Cookie 已更新：${cookieNames.join('、')}`);
        const session = await sendRequest<SiteSession>({ type: 'sessions:check', siteId });
        setSnapshot((prev) =>
          prev ? { ...prev, sessions: { ...prev.sessions, [siteId]: session } } : prev,
        );
        await openDiagnosis(siteId);
      } catch (error) {
        showToast('error', errorText(error));
      } finally {
        setFixingCookies(false);
      }
    },
    [diagnosis, openDiagnosis, showToast],
  );

  const handleCheck = useCallback(
    async (siteId: string) => {
      setSiteBusy(siteId, true);
      try {
        const session = await sendRequest<SiteSession>({ type: 'sessions:check', siteId });
        setSnapshot((prev) =>
          prev
            ? { ...prev, sessions: { ...prev.sessions, [siteId]: session } }
            : prev,
        );
        if (session.status === 'active') {
          showToast('success', '登录有效');
        } else {
          showToast('warn', `${session.message ?? '需要重新登录'}，已打开诊断`);
          void openDiagnosis(siteId);
        }
      } catch (error) {
        showToast('error', errorText(error));
      } finally {
        setSiteBusy(siteId, false);
      }
    },
    [openDiagnosis, setSiteBusy, showToast],
  );

  const handleToggle = useCallback(
    async (site: SiteConfig) => {
      try {
        await sendRequest({ type: 'sites:set-enabled', siteId: site.id, enabled: !site.enabled });
      } catch (error) {
        showToast('error', errorText(error));
      }
    },
    [showToast],
  );

  const handleSetGroups = useCallback(
    async (updates: Array<{ siteId: string; group?: string }>) => {
      try {
        await sendRequest({ type: 'sites:set-groups', updates });
      } catch (error) {
        showToast('error', errorText(error));
      }
    },
    [showToast],
  );

  const handleDelete = useCallback(
    async (site: SiteConfig) => {
      if (!window.confirm(`确定删除站点「${site.name}」？该操作会同时删除本地登录记录。`)) {
        return;
      }
      try {
        await sendRequest({ type: 'sites:delete', siteId: site.id });
        setFlows((prev) => {
          const next = { ...prev };
          delete next[site.id];
          return next;
        });
        showToast('success', '站点已删除');
      } catch (error) {
        showToast('error', errorText(error));
      }
    },
    [showToast],
  );

  const handleGrant = useCallback(
    async (site: SiteConfig) => {
      try {
        const grantedNow = await ensurePermission(site);
        showToast(grantedNow ? 'success' : 'warn', grantedNow ? '已授权访问' : '授权被取消');
        if (grantedNow) {
          const session = await sendRequest<SiteSession>({ type: 'sessions:check', siteId: site.id });
          setSnapshot((prev) =>
            prev ? { ...prev, sessions: { ...prev.sessions, [site.id]: session } } : prev,
          );
        }
      } catch (error) {
        showToast('error', errorText(error));
      }
    },
    [ensurePermission, showToast],
  );

  const handleOpen = useCallback(
    async (url: string) => {
      try {
        await sendRequest({ type: 'ui:open-url', url });
      } catch (error) {
        showToast('error', errorText(error));
      }
    },
    [showToast],
  );

  const handleSaveSite = useCallback(
    async (draft: SiteDraft) => {
      setSaving(true);
      try {
        const saved = await sendRequest<SiteConfig>({ type: 'sites:save', draft });
        setSnapshot((prev) => {
          if (!prev) {
            return prev;
          }
          const exists = prev.sites.some((site) => site.id === saved.id);
          const nextSites = exists
            ? prev.sites.map((site) => (site.id === saved.id ? saved : site))
            : [...prev.sites, saved];
          return { ...prev, sites: nextSites };
        });
        setSelectedSiteIds((prev) =>
          prev.includes(saved.id) || !saved.enabled ? prev : [...prev, saved.id],
        );
        setEditor(null);
        showToast('success', '站点已保存');
        void refreshGranted([...sites.filter((site) => site.id !== saved.id), saved]);
      } catch (error) {
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [refreshGranted, showToast, sites],
  );

  const handleExport = useCallback(async () => {
    try {
      const result = await sendRequest<{ payload: string; filename: string }>({ type: 'sites:export' });
      downloadText(result.filename, result.payload);
      showToast('success', '站点配置已导出');
    } catch (error) {
      showToast('error', errorText(error));
    }
  }, [showToast]);

  const handleImport = useCallback(async () => {
    if (!importText.trim()) {
      showToast('warn', '请粘贴或选择要导入的 JSON');
      return;
    }
    setImporting(true);
    try {
      const imported = await sendRequest<SiteConfig[]>({
        type: 'sites:import',
        payload: importText,
        replace: importReplace,
      });
      showToast('success', `导入完成，共 ${imported.length} 个站点`);
      setImportOpen(false);
      setImportText('');
    } catch (error) {
      showToast('error', errorText(error));
    } finally {
      setImporting(false);
    }
  }, [importReplace, importText, showToast]);

  const handleSettingsChange = useCallback(
    async (patch: Partial<Settings>) => {
      setSnapshot((prev) =>
        prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev,
      );
      try {
        const next = await sendRequest<Settings>({ type: 'settings:update', patch });
        setSnapshot((prev) => (prev ? { ...prev, settings: next } : prev));
      } catch (error) {
        showToast('error', errorText(error));
      }
    },
    [showToast],
  );

  const handleClearHistory = useCallback(async () => {
    try {
      await sendRequest({ type: 'history:clear' });
      setSnapshot((prev) => (prev ? { ...prev, history: [] } : prev));
    } catch (error) {
      showToast('error', errorText(error));
    }
  }, [showToast]);

  const handleVault = useCallback(
    async (action: 'save' | 'restore' | 'delete', siteId: string) => {
      setSiteBusy(siteId, true);
      try {
        if (action === 'save') {
          const status = await sendRequest<VaultStatusResult>({ type: 'vault:save', siteId });
          setVaults((prev) => ({ ...prev, [siteId]: status }));
          showToast('success', `已备份 ${status.count ?? 0} 条登录 Cookie`);
        } else if (action === 'restore') {
          const result = await sendRequest<{ restored: number; failed: number; total: number }>({
            type: 'vault:restore',
            siteId,
          });
          showToast(
            result.failed > 0 ? 'warn' : 'success',
            `凭证恢复完成：成功 ${result.restored}/${result.total} 条`,
          );
        } else {
          await sendRequest({ type: 'vault:delete', siteId });
          setVaults((prev) => ({ ...prev, [siteId]: { siteId, hasBackup: false } }));
          showToast('info', '凭证快照已删除');
        }
      } catch (error) {
        showToast('error', errorText(error));
      } finally {
        setSiteBusy(siteId, false);
      }
    },
    [setSiteBusy, showToast],
  );

  // ---------- 搜索 ----------
  const handleSearch = useCallback(
    (value: string) => {
      const normalized = value.trim();
      if (!normalized) {
        return;
      }
      if (selectedSiteIds.length === 0) {
        showToast('warn', '请至少选择一个搜索站点');
        return;
      }
      const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      if (search?.running) {
        void sendRequest({ type: 'search:cancel', requestId: search.requestId });
      }
      setSearch({
        requestId,
        keyword: normalized,
        siteIds: [...selectedSiteIds],
        running: true,
        progress: {},
        outcomes: {},
        startedAt: Date.now(),
      });
      setKeyword(normalized);
      void sendRequest<SearchRunResult>({
        type: 'search:run',
        keyword: normalized,
        siteIds: [...selectedSiteIds],
        requestId,
      })
        .then(() => {
          setSnapshot((prev) =>
            prev ? { ...prev, history: pushHistory(prev.history, normalized) } : prev,
          );
        })
        .catch((error) => {
          setSearch((prev) =>
            prev && prev.requestId === requestId
              ? { ...prev, running: false, error: errorText(error) }
              : prev,
          );
          showToast('error', errorText(error));
        });
    },
    [selectedSiteIds, search, showToast],
  );

  const handleCancelSearch = useCallback(() => {
    if (!search) {
      return;
    }
    void sendRequest({ type: 'search:cancel', requestId: search.requestId });
    setSearch((prev) => (prev ? { ...prev, running: false } : prev));
  }, [search]);

  const handleToggleSite = useCallback((siteId: string) => {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId],
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedSiteIds((prev) =>
      prev.length === enabledSites.length ? [] : enabledSites.map((site) => site.id),
    );
  }, [enabledSites]);

  const activeLoginCount = useMemo(
    () => Object.values(sessions).filter((session) => session.status === 'active').length,
    [sessions],
  );

  if (loading) {
    return (
      <div className="app-loading">
        <Spinner size={22} />
        <span>正在加载面板…</span>
      </div>
    );
  }

  if (fatal || !snapshot || !settings) {
    return (
      <div className="app-fatal">
        <EmptyState
          icon="alert"
          title="无法连接扩展后台"
          description={fatal ?? '请重新加载扩展后再试。'}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void loadSnapshot()}>
              重新加载
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="search" size={16} />
          </span>
          <div className="brand-text">
            <h1>聚合搜索</h1>
            <span>
              {enabledSites.length} 个站点 · {activeLoginCount} 个已登录
            </span>
          </div>
        </div>
        <div className="header-stats">
          {Object.values(sessions).some((session) => session.status === 'expired') ? (
            <button type="button" className="expired-alert" onClick={() => setTab('sites')}>
              <Icon name="alert" size={14} />
              有登录已过期
            </button>
          ) : null}
        </div>
      </header>

      <nav className="tab-bar" role="tablist">
        {(
          [
            ['search', '搜索', 'search'],
            ['sites', '站点', 'layers'],
            ['settings', '设置', 'settings'],
          ] as Array<[TabKey, string, string]>
        ).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tab ${tab === key ? 'is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon name={icon} size={15} />
            {label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'search' ? (
          <SearchView
            keyword={keyword}
            search={search}
            sites={sites}
            sessions={sessions}
            selectedSiteIds={selectedSiteIds}
            history={snapshot.history}
            onKeywordChange={setKeyword}
            onToggleSite={handleToggleSite}
            onSelectAll={handleSelectAll}
            onSearch={handleSearch}
            onCancel={handleCancelSearch}
            onOpenUrl={handleOpen}
            blockedDomains={settings.blockedDomains ?? []}
            onBlockDomain={(domain: string) => {
              const current = settings.blockedDomains ?? [];
              const next = domain.toLowerCase().replace(/^www\./, '');
              if (!current.includes(next)) {
                void handleSettingsChange({ blockedDomains: [...current, next] });
                showToast('success', `已屏蔽 ${next}`);
              }
            }}
            onLoginSite={handleLogin}
            onClearHistory={handleClearHistory}
          />
        ) : null}

        {tab === 'sites' ? (
          <SitesView
            sites={sites}
            sessions={sessions}
            flows={flows}
            granted={granted}
            busy={busy}
            vaults={vaults}
            onAdd={() => setEditor({ mode: 'create' })}
            onImport={() => setImportOpen(true)}
            onExport={handleExport}
            onLogin={handleLogin}
            onCancelLogin={handleCancelLogin}
            onRefreshQr={handleRefreshQr}
            onFocusLogin={handleFocusLogin}
            onCheck={handleCheck}
            onEdit={(site) => setEditor({ mode: 'edit', site })}
            onDelete={handleDelete}
            onToggle={handleToggle}
            onSetGroups={handleSetGroups}
            onGrant={handleGrant}
            onOpen={handleOpen}
            onDiagnose={(siteId) => void openDiagnosis(siteId)}
            onSaveVault={(siteId) => void handleVault('save', siteId)}
            onRestoreVault={(siteId) => void handleVault('restore', siteId)}
            onDeleteVault={(siteId) => void handleVault('delete', siteId)}
          />
        ) : null}

        {tab === 'settings' ? (
          <SettingsView
            settings={settings}
            historyCount={snapshot.history.length}
            onChange={(patch) => void handleSettingsChange(patch)}
            onClearHistory={() => void handleClearHistory()}
          />
        ) : null}
      </main>

      {diagnosisSiteId ? (
        <Modal
          title="登录态诊断"
          subtitle={sites.find((site) => site.id === diagnosisSiteId)?.name}
          onClose={closeDiagnosis}
          wide
        >
          <DiagnosisModal
            diagnosis={diagnosis}
            loading={diagnosisLoading}
            fixing={fixingCookies}
            onClose={closeDiagnosis}
            onRefresh={() => void openDiagnosis(diagnosisSiteId)}
            onFix={(names) => void handleFixCookies(names)}
          />
        </Modal>
      ) : null}

      {editor ? (
        <Modal
          title={editor.mode === 'create' ? '添加站点' : `编辑站点 · ${editor.site?.name ?? ''}`}
          subtitle="所有配置都保存在本地，可随时修改选择器与检测规则。"
          onClose={() => setEditor(null)}
          wide
        >
          <SiteEditor
            mode={editor.mode}
            initial={editor.site}
            saving={saving}
            onClose={() => setEditor(null)}
            onSave={handleSaveSite}
            onRequestPermission={requestSitePermission}
            onNotice={showToast}
          />
        </Modal>
      ) : null}

      {importOpen ? (
        <Modal
          title="导入站点配置"
          subtitle="支持本扩展导出的 JSON 文件或纯站点数组。"
          onClose={() => setImportOpen(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void handleImport()} disabled={importing}>
                {importing ? <Spinner size={15} /> : <Icon name="upload" size={15} />}
                开始导入
              </button>
            </>
          }
        >
          <div className="import-body">
            <label className="field">
              <span className="field-label">选择 JSON 文件</span>
              <input
                type="file"
                accept="application/json,.json"
                className="input-file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  void file.text().then((text) => setImportText(text));
                }}
              />
            </label>
            <label className="field">
              <span className="field-label">或粘贴 JSON 内容</span>
              <textarea
                className="textarea code"
                rows={10}
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder='{"version":1,"sites":[...]}'
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={importReplace}
                onChange={(event) => setImportReplace(event.target.checked)}
              />
              <span>替换现有全部站点（默认按站点 ID 合并）</span>
            </label>
          </div>
        </Modal>
      ) : null}

      {toast ? <Toast key={toast.id} level={toast.level} message={toast.message} /> : null}
    </div>
  );
}
