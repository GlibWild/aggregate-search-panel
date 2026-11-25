/**
 * 后台请求策略：直接 fetch 搜索页 HTML / JSON 接口。
 *
 * 优点：速度快、无标签页闪烁。
 * 局限：部分站点依赖 SameSite Cookie 或前端渲染，登录态/结果可能缺失，
 *       此时由搜索调度层回退到隐藏标签页策略。
 */
import { createLogger } from '../../shared/logger';
import type { PageExtractOptions } from '../../shared/injected/extract-results';
import { mapApiResults } from '../../shared/search-utils';
import type { SearchResultItem, Settings, SiteConfig } from '../../shared/types';
import { buildSearchUrl, compactText, isLoginLikeUrl } from '../../shared/url-utils';
import { EmptyResultError, LoginRequiredError } from '../errors';
import { parseHtmlInOffscreen } from '../offscreen-client';

const logger = createLogger('fetch-strategy');

export interface FetchStrategyResult {
  items: SearchResultItem[];
  strategy: 'api' | 'fetch';
  finalUrl: string;
}

function resolveMaxResults(site: SiteConfig, settings: Settings): number {
  const value = site.search.maxResults ?? settings.maxResultsPerSite;
  // 多抓取候选，留出同站过滤余量；最终条数由 search-service 在过滤后截取。
  return Math.min(150, Math.max(1, Math.min(50, value)) * 3);
}

function applyKeyword(value: string, keyword: string): string {
  return buildSearchUrl(value, keyword);
}

/** 调用站点 JSON 搜索接口。 */
async function runApiStrategy(
  site: SiteConfig,
  keyword: string,
  settings: Settings,
  signal: AbortSignal,
): Promise<FetchStrategyResult> {
  const api = site.search.api;
  if (!api) {
    throw new EmptyResultError('未配置接口');
  }
  const url = buildSearchUrl(api.urlTemplate, keyword);
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  for (const [key, value] of Object.entries(api.headers ?? {})) {
    headers[key] = applyKeyword(value, keyword);
  }
  const response = await fetch(url, {
    method: api.method,
    headers,
    body:
      api.method === 'POST' && api.bodyTemplate
        ? applyKeyword(api.bodyTemplate, keyword)
        : undefined,
    credentials: 'include',
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    throw new LoginRequiredError(`接口返回 ${response.status}，可能需要重新登录`);
  }
  if (!response.ok) {
    throw new Error(`接口请求失败（HTTP ${response.status}）`);
  }
  const json: unknown = await response.json();
  const items = mapApiResults(json, api, site, resolveMaxResults(site, settings));
  if (items.length === 0) {
    throw new EmptyResultError('接口未返回结果');
  }
  return { items, strategy: 'api', finalUrl: url };
}

/** 抓取搜索页 HTML 并使用通用/自定义选择器提取。 */
async function runHtmlStrategy(
  site: SiteConfig,
  keyword: string,
  settings: Settings,
  signal: AbortSignal,
): Promise<FetchStrategyResult> {
  const url = buildSearchUrl(site.search.urlTemplate, keyword);
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    redirect: 'follow',
    signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  const finalUrl = response.url || url;
  if (response.status === 401 || response.status === 403 || isLoginLikeUrl(finalUrl)) {
    throw new LoginRequiredError('搜索页跳转到了登录页面，请先扫码登录');
  }
  if (!response.ok) {
    throw new Error(`搜索页请求失败（HTTP ${response.status}）`);
  }

  const html = await response.text();
  const options: PageExtractOptions = {
    baseUrl: finalUrl,
    keyword,
    maxResults: resolveMaxResults(site, settings),
    resultSelector: site.search.resultSelector,
    titleSelector: site.search.titleSelector,
    linkSelector: site.search.linkSelector,
    snippetSelector: site.search.snippetSelector,
  };
  const raw = await parseHtmlInOffscreen(html, options);
  if (raw.length === 0) {
    // 页面可能要求登录，或完全由前端渲染。
    const looksLikeLoginPage =
      isLoginLikeUrl(finalUrl) ||
      (html.length < 200_000 && /扫码登录|请先登录|登录后查看/.test(html));
    if (looksLikeLoginPage) {
      throw new LoginRequiredError('页面提示需要登录，请先扫码登录');
    }
    throw new EmptyResultError('页面中未找到搜索结果');
  }

  const items: SearchResultItem[] = raw.map((item) => ({
    siteId: site.id,
    siteName: site.name,
    title: compactText(item.title, 180),
    url: item.url,
    snippet: compactText(item.snippet, 240),
  }));
  logger.debug('后台请求提取完成', { siteId: site.id, count: items.length });
  return { items, strategy: 'fetch', finalUrl };
}

/** 执行后台请求策略。 */
export async function runFetchStrategy(
  site: SiteConfig,
  keyword: string,
  settings: Settings,
  signal: AbortSignal,
): Promise<FetchStrategyResult> {
  if (site.search.api) {
    return runApiStrategy(site, keyword, settings, signal);
  }
  return runHtmlStrategy(site, keyword, settings, signal);
}
