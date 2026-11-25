/**
 * 站点配置的创建、校验、导入导出（纯函数）。
 */
import { collectSiteOrigins, isHttpUrl, normalizeDomainList } from './url-utils';
import { compileUrlPattern } from './url-utils';
import type { SiteConfig, SiteDraft } from './types';

export interface SiteValidationResult {
  site: SiteConfig;
  warnings: string[];
}

/** 生成站点 ID。 */
export function createSiteId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `site_${Date.now().toString(36)}_${random}`;
}

function requireName(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label}不能为空`);
  }
  return trimmed;
}

function requireUrl(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label}不能为空`);
  }
  if (!isHttpUrl(trimmed.includes('{q}') ? trimmed.replace(/\{q\}/gi, 'query') : trimmed)) {
    throw new Error(`${label}必须是合法的 http/https 地址`);
  }
  return trimmed;
}

/** 规范化 Cookie 名称列表（支持逗号分隔字符串输入）。 */
export function normalizeCookieNames(input: string[] | string | undefined): string[] {
  if (!input) {
    return [];
  }
  const list = Array.isArray(input) ? input : input.split(/[,，;；\s]+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of list) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) {
      continue;
    }
    seen.add(name.toLowerCase());
    result.push(name);
  }
  return result;
}

/** 将 UI 提交的草稿校验并转换为完整站点配置。 */
export function buildSiteConfig(
  draft: SiteDraft,
  options: { id?: string; createdAt?: number; now: number },
): SiteValidationResult {
  const warnings: string[] = [];
  const name = requireName(draft.name, '站点名称');
  const homepage = requireUrl(draft.homepage, '站点主页');
  const loginUrl = requireUrl(draft.login.loginUrl, '登录页地址');
  const searchTemplate = requireUrl(draft.search.urlTemplate, '搜索地址模板');

  if (!/\{q\}/i.test(searchTemplate)) {
    throw new Error('搜索地址模板必须包含 {q} 占位符');
  }

  const successPattern = draft.login.successUrlPattern?.trim() ?? '';
  if (successPattern && !compileUrlPattern(successPattern)) {
    throw new Error('登录成功 URL 正则格式不正确');
  }

  const api = draft.search.api;
  if (api) {
    if (!api.urlTemplate.trim()) {
      throw new Error('接口地址不能为空');
    }
    requireUrl(api.urlTemplate, '接口地址');
    if (!api.listPath.trim() || !api.titlePath.trim() || !api.linkPath.trim()) {
      throw new Error('接口配置中的列表、标题、链接路径不能为空');
    }
  }

  const sessionCookieNames = normalizeCookieNames([
    ...normalizeCookieNames(draft.login.sessionCookieNames),
    ...(draft.login.successCookieName ? [draft.login.successCookieName] : []),
  ]);
  if (sessionCookieNames.length === 0) {
    warnings.push('未配置关键 Cookie，扩展只能按兜底有效期判断登录是否过期');
  }

  const maxResults = draft.search.maxResults;
  const normalizedMaxResults =
    typeof maxResults === 'number' && Number.isFinite(maxResults)
      ? Math.min(50, Math.max(1, Math.round(maxResults)))
      : undefined;

  const ttl = draft.login.sessionTtlMinutes;
  const roundedTtl = typeof ttl === 'number' && Number.isFinite(ttl) ? Math.round(ttl) : 0;
  const normalizedTtl =
    roundedTtl >= 1 ? Math.min(60 * 24 * 30, roundedTtl) : undefined;

  const site: SiteConfig = {
    id: options.id ?? draft.id ?? createSiteId(),
    name,
    homepage,
    iconUrl: draft.iconUrl?.trim() || undefined,
    enabled: draft.enabled ?? true,
    login: {
      loginUrl,
      qrSelector: draft.login.qrSelector?.trim() || undefined,
      refreshButtonSelector: draft.login.refreshButtonSelector?.trim() || undefined,
      successUrlPattern: successPattern || undefined,
      successCookieName: draft.login.successCookieName?.trim() || undefined,
      successSelector: draft.login.successSelector?.trim() || undefined,
      sessionCookieNames,
      sessionTtlMinutes: normalizedTtl,
      autoDetectAuthCookie: draft.login.autoDetectAuthCookie ?? true,
    },
    search: {
      urlTemplate: searchTemplate,
      resultSelector: draft.search.resultSelector?.trim() || undefined,
      titleSelector: draft.search.titleSelector?.trim() || undefined,
      linkSelector: draft.search.linkSelector?.trim() || undefined,
      snippetSelector: draft.search.snippetSelector?.trim() || undefined,
      api,
      maxResults: normalizedMaxResults,
      strategy: draft.search.strategy ?? 'auto',
      requiresLogin: draft.search.requiresLogin ?? true,
      sameSiteOnly: draft.search.sameSiteOnly ?? true,
      allowedDomains: normalizeDomainList(draft.search.allowedDomains),
    },
    origins: [],
    group: draft.group?.trim() || undefined,
    notes: draft.notes?.trim() || undefined,
    createdAt: options.createdAt ?? options.now,
    updatedAt: options.now,
  };

  site.origins = collectSiteOrigins(site);
  return { site, warnings };
}

/** 导出的数据结构，带版本号便于后续迁移。 */
export interface SiteExportPayload {
  version: 1;
  exportedAt: string;
  sites: SiteConfig[];
}

/** 生成导出 JSON 文本。 */
export function serializeSites(sites: SiteConfig[]): string {
  const payload: SiteExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sites,
  };
  return JSON.stringify(payload, null, 2);
}

/** 从任意 JSON 文本解析站点配置，兼容纯数组与 { sites: [] } 两种形式。 */
export function parseSitesPayload(text: string, now: number): SiteConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('导入内容不是合法的 JSON');
  }
  const rawSites = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { sites?: unknown }).sites)
      ? ((parsed as { sites: unknown[] }).sites)
      : null;
  if (!rawSites) {
    throw new Error('导入内容缺少 sites 数组');
  }

  const sites: SiteConfig[] = [];
  const errors: string[] = [];
  rawSites.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`第 ${index + 1} 项不是对象`);
      return;
    }
    const candidate = raw as Partial<SiteConfig> & { login?: Partial<SiteConfig['login']>; search?: Partial<SiteConfig['search']> };
    try {
      const draft: SiteDraft = {
        id: typeof candidate.id === 'string' && candidate.id ? candidate.id : undefined,
        name: String(candidate.name ?? ''),
        homepage: String(candidate.homepage ?? ''),
        iconUrl: typeof candidate.iconUrl === 'string' ? candidate.iconUrl : undefined,
        enabled: candidate.enabled !== false,
        group: typeof candidate.group === 'string' && candidate.group.trim() ? candidate.group.trim() : undefined,
        notes: typeof candidate.notes === 'string' ? candidate.notes : undefined,
        login: {
          loginUrl: String(candidate.login?.loginUrl ?? ''),
          qrSelector: candidate.login?.qrSelector,
          refreshButtonSelector: candidate.login?.refreshButtonSelector,
          successUrlPattern: candidate.login?.successUrlPattern,
          successCookieName: candidate.login?.successCookieName,
          successSelector: candidate.login?.successSelector,
          sessionCookieNames: normalizeCookieNames(candidate.login?.sessionCookieNames),
          sessionTtlMinutes: candidate.login?.sessionTtlMinutes,
          autoDetectAuthCookie: candidate.login?.autoDetectAuthCookie !== false,
        },
        search: {
          urlTemplate: String(candidate.search?.urlTemplate ?? ''),
          resultSelector: candidate.search?.resultSelector,
          titleSelector: candidate.search?.titleSelector,
          linkSelector: candidate.search?.linkSelector,
          snippetSelector: candidate.search?.snippetSelector,
          api: candidate.search?.api,
          maxResults: candidate.search?.maxResults,
          strategy: candidate.search?.strategy ?? 'auto',
          requiresLogin: candidate.search?.requiresLogin !== false,
          sameSiteOnly: candidate.search?.sameSiteOnly !== false,
          allowedDomains: Array.isArray(candidate.search?.allowedDomains)
            ? candidate.search?.allowedDomains
            : undefined,
        },
      };
      const { site } = buildSiteConfig(draft, {
        id: draft.id,
        createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : now,
        now,
      });
      sites.push(site);
    } catch (error) {
      errors.push(`第 ${index + 1} 项：${(error as Error).message}`);
    }
  });

  if (sites.length === 0) {
    throw new Error(errors.length > 0 ? `没有可导入的有效站点：${errors[0]}` : '没有可导入的站点');
  }
  return sites;
}
