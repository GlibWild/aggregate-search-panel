/**
 * URL 与文本处理工具（纯函数，可在面板、Service Worker 与测试中复用）。
 */

import { LOGIN_URL_PATTERN } from './constants';
import type { SearchResultItem, SiteConfig } from './types';

/** 规范化用户输入的关键词：去掉首尾空白并合并连续空白。 */
export function normalizeKeyword(keyword: string): string {
  return keyword.replace(/\s+/g, ' ').trim();
}

/** 对关键词做 URL 编码（空格编码为 %20）。 */
export function encodeKeyword(keyword: string): string {
  return encodeURIComponent(normalizeKeyword(keyword));
}

/**
 * 将搜索 URL 模板中的占位符替换为关键词。
 * 支持 {q}、{query}、{keyword} 三种写法。
 */
export function buildSearchUrl(template: string, keyword: string): string {
  const encoded = encodeKeyword(keyword);
  return template
    .replace(/\{q\}/gi, encoded)
    .replace(/\{query\}/gi, encoded)
    .replace(/\{keyword\}/gi, encoded);
}

/** 判断是否为可访问的 http(s) 地址。 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 将相对地址转换为绝对地址，失败时返回空字符串。 */
export function toAbsoluteUrl(href: string | null | undefined, baseUrl: string): string {
  if (!href) {
    return '';
  }
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:')) {
    return '';
  }
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

/** 判断 URL 是否像登录/授权页面（只看主机名与路径，避免关键词误判）。 */
export function isLoginLikeUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return LOGIN_URL_PATTERN.test(parsed.hostname) || LOGIN_URL_PATTERN.test(parsed.pathname);
  } catch {
    return LOGIN_URL_PATTERN.test(url);
  }
}

/** 提取主机名，失败返回空字符串。 */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const MULTI_LEVEL_SUFFIXES = new Set([
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'co.uk',
  'co.jp',
  'com.hk',
  'com.tw',
  'co.kr',
  'com.au',
  'com.sg',
]);

/** IP 地址或 localhost 本身即可作为权限主机，不生成通配。 */
function isBareHost(hostname: string): boolean {
  return (
    !hostname ||
    hostname === 'localhost' ||
    hostname.includes(':') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * 推导站点主域：www.bilibili.com -> bilibili.com
 *
 * 登录 Cookie 通常写在主域（如 domain=.bilibili.com），
 * 只有子域权限时 cookies.getAll 读不到这些 Cookie，因此权限需要覆盖主域。
 */
export function getBaseDomain(hostname: string): string {
  const host = hostname.toLowerCase().trim();
  if (isBareHost(host)) {
    return host;
  }
  const parts = host.split('.');
  if (parts.length <= 2) {
    return host;
  }
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LEVEL_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * 将地址展开为需要申请的主机权限：
 * - 具体主机：*://www.example.com/*
 * - 主域通配：*://*.example.com/*（用于读取 domain=.example.com 的登录 Cookie）
 */
export function getOriginPatterns(input: string): string[] {
  const raw = input.trim();
  if (!raw) {
    return [];
  }
  if (raw.startsWith('*://')) {
    const match = /^\*:\/\/([^/]+)/.exec(raw);
    const host = (match?.[1] ?? '').toLowerCase();
    const patterns = new Set<string>([raw]);
    const base = getBaseDomain(host.replace(/^\*\./, ''));
    if (base && !isBareHost(base)) {
      patterns.add(`*://*.${base}/*`);
    }
    return [...patterns];
  }
  try {
    const normalized = raw.includes('{q}') ? raw.replace(/\{q\}/gi, 'query') : raw;
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return [];
    }
    const hostname = url.hostname;
    const patterns = new Set<string>([`*://${hostname}/*`]);
    const base = getBaseDomain(hostname);
    if (base && !isBareHost(base)) {
      patterns.add(`*://*.${base}/*`);
    }
    return [...patterns];
  } catch {
    return [];
  }
}

/**
 * 根据任意站点地址生成主机权限匹配模式（返回具体主机模式）。
 * 需要完整权限时请使用 getOriginPatterns。
 */
export function getOriginPattern(input: string): string {
  return getOriginPatterns(input)[0] ?? '';
}

/** 汇总一个站点需要申请的全部主机权限（含主域通配）。 */
export function collectSiteOrigins(site: Pick<SiteConfig, 'homepage' | 'login' | 'search'>): string[] {
  const candidates = [
    site.homepage,
    site.login.loginUrl,
    site.search.urlTemplate,
    site.search.api?.urlTemplate ?? '',
  ];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    for (const pattern of getOriginPatterns(candidate)) {
      origins.add(pattern);
    }
  }
  return [...origins];
}

/** 编译 URL 正则，非法表达式一律返回 null（不抛异常）。 */
export function compileUrlPattern(pattern: string | undefined): RegExp | null {
  if (!pattern || !pattern.trim()) {
    return null;
  }
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

/** 测试 URL 是否匹配给定正则。 */
export function matchesUrlPattern(pattern: string | undefined, url: string): boolean {
  const regex = compileUrlPattern(pattern);
  if (!regex) {
    return false;
  }
  return regex.test(url);
}

const TRACKING_PARAM_PATTERN = /^(?:utm_|spm|from|share_|ref_|source$|_source)/i;

/**
 * 生成用于去重的规范化 URL：
 * - 去掉 hash
 * - 移除常见跟踪参数
 * - 去掉末尾多余的斜杠
 */
export function normalizeUrlForDedupe(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    const kept = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      if (!TRACKING_PARAM_PATTERN.test(key)) {
        kept.append(key, value);
      }
    }
    const query = kept.toString();
    const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return rawUrl;
  }
}

/** 结果去重：按规范化 URL 保留首次出现的条目。 */
export function dedupeResults<T extends Pick<SearchResultItem, 'url'>>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (!item.url) {
      continue;
    }
    const key = normalizeUrlForDedupe(item.url);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** 压缩文本中的空白并截断到指定长度。 */
export function compactText(text: string, maxLength = 200): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength).trimEnd()}…`;
}

/** 转义正则元字符，供构造动态正则使用。 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 展示用的站点域名（去掉 www. 前缀）。 */
export function displayHostname(url: string): string {
  return safeHostname(url).replace(/^www\./i, '');
}

/** 规范化域名输入：支持带协议、通配符、路径、端口或前缀点的写法。 */
export function normalizeDomain(value: string): string {
  let host = value.trim().toLowerCase();
  if (!host) {
    return '';
  }
  // 去掉协议与 userinfo，再依次处理路径、查询、端口
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split('/')[0].split('?')[0].split('#')[0];
  if (host.includes('@')) {
    host = host.split('@').pop() ?? host;
  }
  host = host.replace(/^\*\./, '').replace(/^\./, '');
  if (host.includes(':') && !host.includes(']')) {
    host = host.split(':')[0];
  }
  return host.trim();
}

/** 规范化域名列表（支持逗号/空白分隔的字符串），去重并忽略非法项。 */
export function normalizeDomainList(input: string[] | string | undefined): string[] {
  if (!input) {
    return [];
  }
  const list = Array.isArray(input) ? input : input.split(/[,，;；\s]+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of list) {
    const host = normalizeDomain(raw);
    if (!host || seen.has(host)) {
      continue;
    }
    seen.add(host);
    result.push(host);
  }
  return result;
}

/** 判断主机是否属于给定主域（含子域）。 */
export function isHostUnderDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  const base = domain.toLowerCase();
  if (!host || !base) {
    return false;
  }
  return host === base || host.endsWith(`.${base}`);
}

/**
 * 汇总站点允许的结果域名（主域级别）：
 * 站点主页/登录页/搜索页的主域 + 用户额外配置的允许域名。
 */
export function getSiteScopeDomains(
  site: Pick<SiteConfig, 'homepage' | 'login' | 'search'>,
): string[] {
  const urls = [
    site.homepage,
    site.login.loginUrl,
    site.search.urlTemplate,
    site.search.api?.urlTemplate ?? '',
  ];
  const domains = new Set<string>();
  for (const url of urls) {
    const host = safeHostname(url.includes('{q}') ? url.replace(/\{q\}/gi, 'query') : url);
    if (host) {
      domains.add(getBaseDomain(host));
    }
  }
  for (const extra of normalizeDomainList(site.search.allowedDomains)) {
    if (extra) {
      domains.add(getBaseDomain(extra));
    }
  }
  return [...domains];
}

/** 判断结果链接是否属于站点域名范围（同站过滤）。 */
export function isUrlWithinSiteScope(
  url: string,
  site: Pick<SiteConfig, 'homepage' | 'login' | 'search'>,
): boolean {
  const host = safeHostname(url);
  if (!host) {
    return false;
  }
  return getSiteScopeDomains(site).some((domain) => isHostUnderDomain(host, domain));
}

/** 过滤掉不属于站点域名的结果。 */
export function filterResultsWithinSite<T extends { url: string }>(
  items: T[],
  site: Pick<SiteConfig, 'homepage' | 'login' | 'search'>,
): T[] {
  return items.filter((item) => isUrlWithinSiteScope(item.url, site));
}

/** 字符串安全比较（大小写不敏感），用于 Cookie 名称匹配。 */
export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
