/**
 * 站点卡片：登录状态、二维码、常用操作。
 */
import type { LoginFlowState, SiteConfig, SiteSession } from '../../shared/types';
import type { VaultStatusResult } from '../../shared/messages';
import { displayHostname } from '../../shared/url-utils';
import { formatDateTime, siteInitial, siteTone, summarizeSession } from '../utils';
import { Icon, Spinner, StatusDot } from './Ui';
import { QrPanel } from './QrPanel';

interface SiteCardProps {
  site: SiteConfig;
  session?: SiteSession;
  flow?: LoginFlowState;
  granted: boolean;
  busy: boolean;
  vault?: VaultStatusResult;
  onLogin: () => void;
  onCancelLogin: () => void;
  onRefreshQr: () => void;
  onFocusLogin: () => void;
  onCheck: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onGrant: () => void;
  onOpen: () => void;
  onDiagnose: () => void;
  onSaveVault: () => void;
  onRestoreVault: () => void;
  onDeleteVault: () => void;
}

const STRATEGY_LABEL: Record<string, string> = {
  auto: '自动',
  fetch: '后台请求',
  tab: '隐藏标签页',
};

export function SiteCard({
  site,
  session,
  flow,
  granted,
  busy,
  vault,
  onLogin,
  onCancelLogin,
  onRefreshQr,
  onFocusLogin,
  onCheck,
  onEdit,
  onDelete,
  onToggleEnabled,
  onGrant,
  onOpen,
  onDiagnose,
  onSaveVault,
  onRestoreVault,
  onDeleteVault,
}: SiteCardProps) {
  const summary = summarizeSession(session);
  const loginActive = flow && ['starting', 'waiting', 'qr-missing'].includes(flow.status);
  const needsLogin = summary.tone === 'danger' || summary.tone === 'muted';

  return (
    <article className={`site-card ${site.enabled ? '' : 'is-disabled'}`}>
      <header className="site-head">
        <div className="site-avatar" style={{ background: siteTone(site.name) }}>
          {site.iconUrl ? (
            <img
              src={site.iconUrl}
              alt=""
              onError={(event) => {
                (event.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            siteInitial(site.name)
          )}
        </div>
        <div className="site-title">
          <div className="site-name-row">
            <h3>{site.name}</h3>
            <span className={`session-pill tone-${summary.tone}`}>
              <StatusDot tone={summary.tone} />
              {summary.label}
            </span>
          </div>
          <span className="site-host">{displayHostname(site.homepage)}</span>
        </div>
        <button
          type="button"
          className={`mini-toggle ${site.enabled ? 'is-on' : ''}`}
          onClick={onToggleEnabled}
          title={site.enabled ? '停用站点' : '启用站点'}
          aria-pressed={site.enabled}
        >
          <span />
        </button>
      </header>

      <p className="site-session-detail">{summary.detail}</p>

      {!granted ? (
        <div className="site-warning">
          <Icon name="shield" size={14} />
          <span>尚未授权访问该站点，无法读取登录态或搜索结果</span>
          <button type="button" className="btn btn-tiny" onClick={onGrant}>
            授权访问
          </button>
        </div>
      ) : null}

      <div className="site-actions">
        <button
          type="button"
          className={`btn ${needsLogin ? 'btn-primary' : 'btn-soft'} btn-sm`}
          onClick={onLogin}
          disabled={busy}
        >
          {busy ? <Spinner size={14} /> : <Icon name="qr" size={14} />}
          {loginActive ? '登录中…' : needsLogin ? '扫码登录' : '重新扫码'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
          <Icon name="external" size={14} />
          打开网站
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCheck} disabled={busy}>
          <Icon name="refresh" size={14} />
          检测
        </button>
      </div>

      {loginActive && flow ? (
        <QrPanel
          flow={flow}
          site={site}
          busy={busy}
          onRefresh={onRefreshQr}
          onCancel={onCancelLogin}
          onFocus={onFocusLogin}
        />
      ) : null}

      {flow?.status === 'success' ? (
        <div className="site-success">
          <Icon name="check" size={15} />
          <span>{flow.message ?? '登录成功'}{flow.accountLabel ? `（${flow.accountLabel}）` : ''}</span>
        </div>
      ) : null}

      <details className="site-more">
        <summary>
          <Icon name="chevron" size={14} />
          更多操作与配置
        </summary>
        <div className="site-more-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDiagnose}>
            <Icon name="shield" size={14} />
            诊断登录状态
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <Icon name="edit" size={14} />
            编辑站点
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSaveVault}>
            <Icon name="key" size={14} />
            备份登录凭证
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRestoreVault}
            disabled={!vault?.hasBackup}
            title={vault?.hasBackup ? '使用本地加密快照恢复 Cookie' : '暂无快照'}
          >
            <Icon name="refresh" size={14} />
            恢复登录凭证
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDeleteVault}
            disabled={!vault?.hasBackup}
          >
            <Icon name="trash" size={14} />
            删除凭证快照
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={onDelete}>
            <Icon name="trash" size={14} />
            删除站点
          </button>
        </div>
        <dl className="site-config">
          <dt>搜索地址</dt>
          <dd>{site.search.urlTemplate}</dd>
          <dt>关键 Cookie</dt>
          <dd>{site.login.sessionCookieNames.join('、') || '未配置'}</dd>
          <dt>抓取策略</dt>
          <dd>{STRATEGY_LABEL[site.search.strategy ?? 'auto'] ?? site.search.strategy}</dd>
          <dt>凭证快照</dt>
          <dd>
            {vault?.hasBackup
              ? `${formatDateTime(vault.savedAt)} · ${vault.count ?? 0} 条 Cookie`
              : '暂无'}
          </dd>
          {site.notes ? (
            <>
              <dt>备注</dt>
              <dd>{site.notes}</dd>
            </>
          ) : null}
        </dl>
      </details>
    </article>
  );
}
