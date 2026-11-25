/**
 * 搜索调度：跨站点并发抓取、策略回退、进度与结果推送。
 */
import { createLogger } from '../shared/logger';
import { pushHistory } from '../shared/search-utils';
import { storage } from '../shared/storage';
import type { SearchRunResult } from '../shared/messages';
import type {
  SearchResultItem,
  SearchStrategy,
  Settings,
  SiteConfig,
  SiteSearchOutcome,
} from '../shared/types';
import { SEARCH_TIMEOUT_MS } from '../shared/constants';
import { normalizeKeyword } from '../shared/url-utils';
import { filterResultsWithinSite, isUrlWithinSiteScope, safeHostname } from '../shared/url-utils';
import { mapWithConcurrency, withTimeout } from './async-utils';
import { CancelledError, EmptyResultError, LoginRequiredError, errorMessage } from './errors';
import { broadcast, runtimeState } from './runtime';
import { checkSiteSession } from './session-service';
import { hasSiteAccess } from './permissions';
import { runFetchStrategy } from './search/fetch-strategy';
import { runTabStrategy } from './search/tab-strategy';

const logger = createLogger('search-service');

interface StrategyOutcome {
  items: SearchResultItem[];
  strategy: 'api' | 'fetch' | 'tab';
  finalUrl: string;
}

/** 按策略依次尝试，auto 模式下自动回退隐藏标签页。 */
async function executeStrategies(
  site: SiteConfig,
  keyword: string,
  settings: Settings,
  strategy: SearchStrategy,
  signal: AbortSignal,
): Promise<StrategyOutcome> {
  const attempts: Array<'fetch' | 'tab'> =
    strategy === 'tab'
      ? ['tab']
      : strategy === 'fetch'
        ? ['fetch']
        : ['fetch', 'tab'];

  let lastError: unknown = new EmptyResultError();
  for (const attempt of attempts) {
    try {
      if (attempt === 'tab') {
        return await runTabStrategy(site, keyword, settings, signal);
      }
      return await runFetchStrategy(site, keyword, settings, signal);
    } catch (error) {
      if (error instanceof CancelledError || signal.aborted) {
        throw error;
      }
      lastError = error;
      logger.debug('搜索策略未成功，准备回退', {
        siteId: site.id,
        attempt,
        error: errorMessage(error),
      });
    }
  }
  throw lastError;
}

/** 执行单个站点的完整搜索流程。 */
async function searchOneSite(
  site: SiteConfig,
  keyword: string,
  settings: Settings,
  requestId: string,
  signal: AbortSignal,
): Promise<SiteSearchOutcome> {
  const startedAt = Date.now();
  const base = {
    siteId: site.id,
    siteName: site.name,
    items: [] as SearchResultItem[],
  };

  await broadcast({ kind: 'search-progress', requestId, siteId: site.id, phase: 'queued' });

  if (!(await hasSiteAccess(site))) {
    return {
      ...base,
      status: 'error',
      durationMs: Date.now() - startedAt,
      message: `尚未授权访问 ${site.name}，请在站点卡片上点击“授权访问”`,
    };
  }

  // 不强制登录：未登录时也照常尝试搜索，只有拿不到结果时才提示登录。
  let notLoggedIn = false;
  if (site.search.requiresLogin) {
    try {
      const session = await checkSiteSession(site);
      notLoggedIn = session.status !== 'active';
    } catch {
      notLoggedIn = true;
    }
  }

  const strategy = site.search.strategy ?? settings.defaultStrategy;
  await broadcast({
    kind: 'search-progress',
    requestId,
    siteId: site.id,
    phase: strategy === 'tab' ? 'rendering' : 'requesting',
  });

  try {
    const result = await withTimeout(
      (timeoutSignal) => executeStrategies(site, keyword, settings, strategy, timeoutSignal),
      SEARCH_TIMEOUT_MS,
      signal,
    );
    const maxResults = Math.max(1, Math.min(50, site.search.maxResults ?? settings.maxResultsPerSite));
    const useScope = site.search.sameSiteOnly !== false;
    const scoped = useScope ? filterResultsWithinSite(result.items, site) : result.items;
    const removedItems = useScope
      ? result.items.filter((item) => !isUrlWithinSiteScope(item.url, site))
      : [];
    const removedCount = removedItems.length;
    const removedDomains = [...new Set(removedItems.map((item) => safeHostname(item.url)).filter(Boolean))].slice(0, 3);
    const removedHint = removedDomains.length > 0 ? `（${removedDomains.join('、')}）` : '';
    const blocked = (settings.blockedDomains ?? []).map((domain) => domain.toLowerCase());
    const isBlocked = (url: string): boolean => {
      const host = safeHostname(url).toLowerCase();
      return Boolean(host) && blocked.some((domain) => host === domain || host.endsWith(`.${domain}`));
    };
    const items = scoped.filter((item) => !isBlocked(item.url)).slice(0, maxResults);
    if (items.length === 0 && notLoggedIn) {
      return {
        ...base,
        status: 'login-required',
        durationMs: Date.now() - startedAt,
        strategy: result.strategy,
        message: '未登录状态下没有搜到结果，扫码登录后可能获得更多内容',
      };
    }
    return {
      ...base,
      status: items.length > 0 ? 'ok' : 'empty',
      items,
      durationMs: Date.now() - startedAt,
      strategy: result.strategy,
      message:
        items.length > 0
          ? removedCount > 0
            ? `已过滤 ${removedCount} 条站外链接${removedHint}`
            : undefined
          : removedCount > 0
            ? `结果均不属于 ${site.name} 域名，已过滤 ${removedCount} 条站外链接${removedHint}`
            : '没有搜索结果',
    };
  } catch (error) {
    const message = errorMessage(error);
    if (error instanceof LoginRequiredError) {
      return {
        ...base,
        status: 'login-required',
        durationMs: Date.now() - startedAt,
        message,
      };
    }
    if (signal.aborted) {
      return {
        ...base,
        status: 'cancelled',
        durationMs: Date.now() - startedAt,
        message: '搜索已取消',
      };
    }
    logger.warn('站点搜索失败', { siteId: site.id, message });
    return {
      ...base,
      status: 'error',
      durationMs: Date.now() - startedAt,
      message,
    };
  }
}

/** 执行整批搜索（后台异步任务）。 */
async function executeSearch(
  requestId: string,
  keyword: string,
  sites: SiteConfig[],
  settings: Settings,
  controller: AbortController,
): Promise<void> {
  try {
    await mapWithConcurrency(sites, settings.concurrency, async (site) => {
      if (controller.signal.aborted) {
        return;
      }
      let outcome: SiteSearchOutcome;
      try {
        outcome = await searchOneSite(site, keyword, settings, requestId, controller.signal);
      } catch (error) {
        outcome = {
          siteId: site.id,
          siteName: site.name,
          status: 'error',
          items: [],
          durationMs: 0,
          message: errorMessage(error),
        };
      }
      await broadcast({ kind: 'search-outcome', requestId, outcome });
      await broadcast({ kind: 'search-progress', requestId, siteId: site.id, phase: 'done' });
    });
    await broadcast({
      kind: 'search-done',
      requestId,
      keyword,
      finishedAt: Date.now(),
    });
    logger.info('批量搜索完成', { requestId, keyword, sites: sites.length });
  } catch (error) {
    logger.error('批量搜索异常', error, { requestId });
    await broadcast({
      kind: 'search-done',
      requestId,
      keyword,
      finishedAt: Date.now(),
    });
  } finally {
    runtimeState.searchControllers.delete(requestId);
  }
}

/** 发起搜索，立即返回 requestId，结果通过事件推送。 */
export async function startSearch(
  keyword: string,
  siteIds: string[],
  requestIdInput?: string,
): Promise<SearchRunResult> {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) {
    throw new Error('请输入搜索关键词');
  }
  const allSites = await storage.getSites();
  const wanted = new Set(siteIds);
  const sites = allSites.filter(
    (site) => site.enabled && (wanted.size === 0 || wanted.has(site.id)),
  );
  if (sites.length === 0) {
    throw new Error('没有可用的站点，请先添加并启用站点');
  }

  const settings = await storage.getSettings();
  const requestId =
    requestIdInput?.trim() ||
    `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const controller = new AbortController();
  runtimeState.searchControllers.set(requestId, controller);

  const history = await storage.getHistory();
  await storage.setHistory(pushHistory(history, normalized));

  void executeSearch(requestId, normalized, sites, settings, controller);
  logger.info('开始搜索', { requestId, keyword: normalized, sites: sites.length });
  return { requestId, queuedSiteIds: sites.map((site) => site.id) };
}

/** 取消进行中的搜索。 */
export async function cancelSearch(requestId: string): Promise<void> {
  const controller = runtimeState.searchControllers.get(requestId);
  if (!controller) {
    return;
  }
  controller.abort(new CancelledError());
  runtimeState.searchControllers.delete(requestId);
  logger.info('已取消搜索', { requestId });
}
