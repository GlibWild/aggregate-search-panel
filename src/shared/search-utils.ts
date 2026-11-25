/**
 * 搜索结果映射与历史记录（纯函数）。
 */
import type { SearchResultItem, SiteApiConfig, SiteConfig } from './types';
import { compactText, dedupeResults, normalizeKeyword, toAbsoluteUrl } from './url-utils';

/** 按路径读取嵌套值，支持 data.list[0].title 形式。 */
export function getByPath(input: unknown, path: string): unknown {
  if (!path) {
    return input;
  }
  const tokens = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((token) => token.trim())
    .filter(Boolean);
  let current: unknown = input;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(token);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/** 将 JSON 接口返回的数据映射为统一结果结构。 */
export function mapApiResults(
  json: unknown,
  api: SiteApiConfig,
  site: Pick<SiteConfig, 'id' | 'name' | 'homepage' | 'search'>,
  maxResults: number,
): SearchResultItem[] {
  const list = getByPath(json, api.listPath);
  if (!Array.isArray(list)) {
    return [];
  }
  const baseUrl = site.homepage;
  const items: SearchResultItem[] = [];
  for (const entry of list) {
    const title = compactText(asText(getByPath(entry, api.titlePath)), 180);
    const rawLink = asText(getByPath(entry, api.linkPath));
    const url = toAbsoluteUrl(rawLink, baseUrl);
    if (!title || !url) {
      continue;
    }
    const snippet = api.snippetPath
      ? compactText(asText(getByPath(entry, api.snippetPath)), 240)
      : '';
    items.push({ siteId: site.id, siteName: site.name, title, url, snippet });
    if (items.length >= maxResults) {
      break;
    }
  }
  return dedupeResults(items);
}

/** 把关键词插入搜索历史（去重、置顶、限制长度）。 */
export function pushHistory(history: string[], keyword: string, limit = 30): string[] {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) {
    return history;
  }
  const rest = history.filter((item) => item.toLowerCase() !== normalized.toLowerCase());
  return [normalized, ...rest].slice(0, limit);
}

/** 结果条目按站点分组后保持原顺序。 */
export function groupResultsBySite(
  items: SearchResultItem[],
): Array<{ siteId: string; siteName: string; items: SearchResultItem[] }> {
  const groups = new Map<string, { siteId: string; siteName: string; items: SearchResultItem[] }>();
  for (const item of items) {
    const existing = groups.get(item.siteId);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.siteId, {
        siteId: item.siteId,
        siteName: item.siteName,
        items: [item],
      });
    }
  }
  return [...groups.values()];
}

/** 生成域名首字母作为 favicon 回退展示。 */
export function siteInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
}
