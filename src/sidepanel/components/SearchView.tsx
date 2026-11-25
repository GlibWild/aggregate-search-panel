/**
 * 搜索页。
 */
import { useEffect, useRef } from 'react';
import type {
  SearchPhase,
  SearchResultItem,
  SiteConfig,
  SiteSearchOutcome,
  SiteSession,
} from '../../shared/types';
import { displayHostname } from '../../shared/url-utils';
import { summarizeSession, siteInitial, siteTone } from '../utils';
import { Chip, EmptyState, Icon, Spinner, StatusDot } from './Ui';

export interface SearchState {
  requestId: string;
  keyword: string;
  siteIds: string[];
  running: boolean;
  progress: Record<string, SearchPhase>;
  outcomes: Record<string, SiteSearchOutcome>;
  error?: string;
  startedAt: number;
}

interface SearchViewProps {
  blockedDomains?: string[];
  onBlockDomain?: (domain: string) => void;
  keyword: string;
  search: SearchState | null;
  sites: SiteConfig[];
  sessions: Record<string, SiteSession>;
  selectedSiteIds: string[];
  history: string[];
  onKeywordChange: (value: string) => void;
  onToggleSite: (siteId: string) => void;
  onSelectAll: () => void;
  onSearch: (keyword: string) => void;
  onCancel: () => void;
  onOpenUrl: (url: string) => void;
  onLoginSite: (siteId: string) => void;
  onClearHistory: () => void;
}

const PHASE_LABEL: Record<SearchPhase, string> = {
  queued: '排队中',
  requesting: '请求页面',
  rendering: '渲染页面',
  parsing: '解析结果',
  done: '已完成',
};

const STATUS_LABEL: Record<SiteSearchOutcome['status'], string> = {
  ok: '完成',
  empty: '无结果',
  'login-required': '需要登录',
  error: '抓取失败',
  cancelled: '已取消',
};

function ResultRow({
  item,
  onOpenUrl,
  onBlockDomain,
}: {
  item: SearchResultItem;
  onOpenUrl: (url: string) => void;
  onBlockDomain?: (domain: string) => void;
}) {
  const host = displayHostname(item.url);
  return (
    <div className="result-row">
      <a
        className="result-item"
        href={item.url}
        onClick={(event) => {
          event.preventDefault();
          onOpenUrl(item.url);
        }}
      >
        <span className="result-title">{item.title}</span>
        {item.snippet ? <span className="result-snippet">{item.snippet}</span> : null}
        <span className="result-host">
          <Icon name="link" size={12} />
          {host}
        </span>
      </a>
      {onBlockDomain && host ? (
        <button
          type="button"
          className="result-block-btn"
          title={`屏蔽域名 ${host}，以后的搜索结果不再显示`}
          onClick={() => {
            if (window.confirm(`屏蔽域名「${host}」？该域名及其子域名的结果将不再显示，可在设置中解除。`)) {
              onBlockDomain(host);
            }
          }}
        >
          <Icon name="close" size={12} />
          屏蔽
        </button>
      ) : null}
    </div>
  );
}

function isHostBlocked(url: string, blocked: string[]): boolean {
  const host = displayHostname(url).toLowerCase();
  return Boolean(host) && blocked.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function SearchView({
  keyword,
  search,
  sites,
  sessions,
  selectedSiteIds,
  history,
  onKeywordChange,
  onToggleSite,
  onSelectAll,
  onSearch,
  onCancel,
  onOpenUrl,
  blockedDomains = [],
  onBlockDomain,
  onLoginSite,
  onClearHistory,
}: SearchViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const enabledSites = sites.filter((site) => site.enabled);
  const groups: Array<[string, SiteConfig[]]> = (() => {
    const map = new Map<string, SiteConfig[]>();
    enabledSites.forEach((site) => {
      const name = site.group?.trim();
      if (!name) {
        return;
      }
      map.set(name, [...(map.get(name) ?? []), site]);
    });
    return [...map.entries()];
  })();
  const searchSites = search
    ? search.siteIds
        .map((siteId) => sites.find((site) => site.id === siteId))
        .filter((site): site is SiteConfig => Boolean(site))
    : [];
  const total = searchSites.length;
  const finished = search
    ? searchSites.filter((site) => search.outcomes[site.id] || search.progress[site.id] === 'done').length
    : 0;
  const resultCount = search
    ? Object.values(search.outcomes).reduce((sum, outcome) => sum + outcome.items.length, 0)
    : 0;

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <div className="search-view">
      <div className="search-bar">
        <div className="search-input-wrap">
          <Icon name="search" size={16} className="search-icon" />
          <input
            ref={inputRef}
            className="search-input"
            value={keyword}
            placeholder="输入关键词，跨站点搜索…"
            onChange={(event) => onKeywordChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                onSearch(keyword);
              }
            }}
          />
          {keyword ? (
            <button type="button" className="icon-btn icon-btn-sm" onClick={() => onKeywordChange('')} title="清空">
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </div>
        {search?.running ? (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            <Icon name="close" size={15} />
            取消
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSearch(keyword)}
            disabled={!keyword.trim()}
          >
            {search?.running ? <Spinner size={15} /> : <Icon name="search" size={15} />}
            搜索
          </button>
        )}
      </div>

      <div className="site-filter">
        <div className="site-filter-head">
          <span className="section-label">搜索范围</span>
          <button type="button" className="text-btn" onClick={onSelectAll}>
            {selectedSiteIds.length === enabledSites.length ? '全部取消' : '全选'}
          </button>
        </div>
        <div className="chip-scroll">
          {enabledSites.length === 0 ? (
            <span className="section-hint">还没有启用的站点，请先到“站点”页添加。</span>
          ) : (
            enabledSites.map((site) => {
              const session = sessions[site.id];
              const tone = summarizeSession(session).tone;
              return (
                <Chip
                  key={site.id}
                  active={selectedSiteIds.includes(site.id)}
                  onClick={() => onToggleSite(site.id)}
                  title={`${site.name} · ${summarizeSession(session).label}`}
                >
                  <StatusDot tone={tone} />
                  {site.name}
                </Chip>
              );
            })
          )}
        </div>
        {groups.length > 0 ? (
          <div className="chip-scroll group-chips">
            {groups.map(([groupName, groupSites]) => {
              const allSelected = groupSites.every((site) => selectedSiteIds.includes(site.id));
              return (
                <Chip
                  key={groupName}
                  active={allSelected}
                  title={`${allSelected ? '取消选中' : '一键选中'}“${groupName}”分组（${groupSites.length} 个站点）`}
                  onClick={() => {
                    groupSites
                      .filter((site) => (allSelected ? true : !selectedSiteIds.includes(site.id)))
                      .forEach((site) => onToggleSite(site.id));
                  }}
                >
                  <Icon name="layers" size={12} />
                  {groupName} · {groupSites.length}
                </Chip>
              );
            })}
          </div>
        ) : null}
      </div>

      {!search ? (
        <div className="search-idle">
          {history.length > 0 ? (
            <section className="history-block">
              <div className="site-filter-head">
                <span className="section-label">最近搜索</span>
                <button type="button" className="text-btn" onClick={onClearHistory}>
                  清空
                </button>
              </div>
              <div className="chip-scroll">
                {history.map((item) => (
                  <Chip key={item} onClick={() => onSearch(item)}>
                    <Icon name="clock" size={12} />
                    {item}
                  </Chip>
                ))}
              </div>
            </section>
          ) : null}
          <EmptyState
            icon="layers"
            title="一个关键词，搜索所有站点"
            description="添加站点并扫码登录后，输入关键词即可同时检索；结果按站点分组，点击直接跳转到原页面。"
          />
        </div>
      ) : (
        <div className="search-results">
          <div className="search-summary">
            <span>
              “{search.keyword}” · {finished}/{total} 个站点
              {resultCount > 0 ? ` · ${resultCount} 条结果` : ''}
            </span>
            {search.running ? (
              <span className="summary-running">
                <Spinner size={13} />
                搜索中
              </span>
            ) : null}
          </div>

          {search.error ? (
            <div className="inline-error">
              <Icon name="alert" size={15} />
              {search.error}
            </div>
          ) : null}

          {searchSites.map((site) => {
            const outcome = search.outcomes[site.id];
            const phase = search.progress[site.id];
            const session = sessions[site.id];
            return (
              <section className="result-group" key={site.id}>
                <header className="result-group-head">
                  <div className="result-site">
                    <span className="result-avatar" style={{ background: siteTone(site.name) }}>
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
                    </span>
                    <span className="result-site-name">{site.name}</span>
                  </div>
                  <span className={`result-status ${outcome ? `is-${outcome.status}` : ''}`}>
                    {outcome ? (
                      <>
                        {STATUS_LABEL[outcome.status]}
                        {outcome.status === 'ok' ? ` · ${outcome.items.length} 条` : ''}
                        {outcome.strategy ? ` · ${outcome.strategy === 'tab' ? '标签页' : outcome.strategy === 'api' ? '接口' : '请求'}` : ''}
                      </>
                    ) : search.running ? (
                      <>
                        <Spinner size={12} />
                        {phase ? PHASE_LABEL[phase] : '准备中'}
                      </>
                    ) : (
                      '未执行'
                    )}
                  </span>
                </header>

                {outcome?.status === 'login-required' ? (
                  <div className="result-notice">
                    <Icon name="alert" size={14} />
                    <span>{outcome.message ?? '需要登录后搜索'}</span>
                    <button type="button" className="btn btn-tiny" onClick={() => onLoginSite(site.id)}>
                      去扫码
                    </button>
                  </div>
                ) : null}

                {outcome?.status === 'error' ? (
                  <div className="result-notice is-error">
                    <Icon name="alert" size={14} />
                    <span>{outcome.message ?? '抓取失败'}</span>
                    <button type="button" className="btn btn-tiny" onClick={() => onLoginSite(site.id)}>
                      检查登录
                    </button>
                  </div>
                ) : null}

                {outcome?.status === 'ok' && outcome.message ? (
                  <div className="result-notice is-muted">
                    <Icon name="alert" size={14} />
                    <span>{outcome.message}</span>
                  </div>
                ) : null}

                {outcome?.status === 'empty' ? (
                  <div className="result-notice is-muted">
                    <Icon name="search" size={14} />
                    <span>{outcome.message ?? '没有找到结果'}</span>
                  </div>
                ) : null}

                {outcome?.items
                  .filter((item) => !isHostBlocked(item.url, blockedDomains))
                  .map((item) => (
                    <ResultRow key={item.url} item={item} onOpenUrl={onOpenUrl} onBlockDomain={onBlockDomain} />
                  ))}

                {!outcome && search.running ? (
                  <div className="skeleton-list">
                    <span className="skeleton-row" />
                    <span className="skeleton-row" />
                  </div>
                ) : null}

                {!outcome && !search.running ? (
                  <div className="result-notice is-muted">
                    <Icon name="clock" size={14} />
                    <span>该站点没有返回结果（{session ? summarizeSession(session).label : '未登录'}）</span>
                  </div>
                ) : null}
              </section>
            );
          })}

          {searchSites.length === 0 ? (
            <EmptyState
              icon="alert"
              title="没有可搜索的站点"
              description="请检查站点是否已启用，或重新发起搜索。"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
