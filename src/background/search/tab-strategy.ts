/**
 * 隐藏标签页策略：真实加载搜索页并执行前端脚本后再提取结果。
 *
 * 适用：单页应用、依赖登录 Cookie 或前端渲染的站点。
 * 代价：需要创建后台标签页，耗时更长。
 */
import { createLogger } from '../../shared/logger';
import {
  extractPageResults,
  type PageExtractOptions,
  type RawPageResult,
} from '../../shared/injected/extract-results';
import type { SearchResultItem, Settings, SiteConfig } from '../../shared/types';
import { buildSearchUrl, compactText, isLoginLikeUrl } from '../../shared/url-utils';
import { assertSiteAccess } from '../permissions';
import { CancelledError, EmptyResultError, LoginRequiredError } from '../errors';

const logger = createLogger('tab-strategy');

const TAB_LOAD_TIMEOUT_MS = 15_000;

export interface TabStrategyResult {
  items: SearchResultItem[];
  strategy: 'tab';
  finalUrl: string;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new CancelledError();
}

/** 等待标签页加载完成。 */
function waitForTabComplete(tabId: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onUpdated = (updatedTabId: number, info: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId === tabId && info.status === 'complete') {
        finish();
      }
    };
    const onAbort = (): void => finish(abortReason(signal));
    const timer = setTimeout(() => finish(new Error('页面加载超时')), TAB_LOAD_TIMEOUT_MS);

    chrome.tabs.onUpdated.addListener(onUpdated);
    signal.addEventListener('abort', onAbort, { once: true });
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') {
          finish();
        }
      })
      .catch(() => finish(new Error('标签页已关闭')));
  });
}

async function injectExtract(
  tabId: number,
  options: PageExtractOptions,
): Promise<RawPageResult[]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageResults,
    args: [options],
  });
  const raw = results[0]?.result;
  return Array.isArray(raw) ? (raw as RawPageResult[]) : [];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 执行隐藏标签页抓取。 */
export async function runTabStrategy(
  site: SiteConfig,
  keyword: string,
  settings: Settings,
  signal: AbortSignal,
): Promise<TabStrategyResult> {
  await assertSiteAccess(site);
  const url = buildSearchUrl(site.search.urlTemplate, keyword);
  // 多抓取一些候选，留出同站过滤的余量；最终条数由 search-service 在过滤后截取。
  const maxResults = Math.min(150, Math.max(1, Math.min(50, site.search.maxResults ?? settings.maxResultsPerSite)) * 3);

  const tab = await chrome.tabs.create({ url, active: false });
  if (typeof tab.id !== 'number') {
    throw new Error('无法创建抓取标签页');
  }
  const tabId = tab.id;
  logger.debug('已打开抓取标签页', { siteId: site.id, tabId, url });

  try {
    await waitForTabComplete(tabId, signal);
    const loaded = await chrome.tabs.get(tabId);
    const finalUrl = loaded.url ?? url;
    if (isLoginLikeUrl(finalUrl)) {
      throw new LoginRequiredError('搜索页跳转到了登录页面，请先扫码登录');
    }

    const options: PageExtractOptions = {
      baseUrl: finalUrl,
      keyword,
      maxResults,
      resultSelector: site.search.resultSelector,
      titleSelector: site.search.titleSelector,
      linkSelector: site.search.linkSelector,
      snippetSelector: site.search.snippetSelector,
    };

    let raw: RawPageResult[] = [];
    const delays = [500, 1200, 2500, 4000];
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      raw = await injectExtract(tabId, options);
      if (raw.length > 0) {
        break;
      }
      if (attempt < delays.length - 1) {
        await sleep(delays[attempt], signal);
      }
    }

    if (raw.length === 0) {
      throw new EmptyResultError('页面中未找到搜索结果');
    }

    const items: SearchResultItem[] = raw.map((item) => ({
      siteId: site.id,
      siteName: site.name,
      title: compactText(item.title, 180),
      url: item.url,
      snippet: compactText(item.snippet, 240),
    }));
    logger.info('隐藏标签页提取完成', { siteId: site.id, count: items.length });
    return { items, strategy: 'tab', finalUrl };
  } finally {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}
