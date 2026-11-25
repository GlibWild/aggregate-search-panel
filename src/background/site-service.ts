/**
 * 站点配置业务逻辑。
 */
import { createLogger } from '../shared/logger';
import { parseSitesPayload, buildSiteConfig, normalizeCookieNames, serializeSites } from '../shared/site-utils';
import { collectSiteOrigins } from '../shared/url-utils';
import { storage } from '../shared/storage';
import type { SiteConfig, SiteDraft } from '../shared/types';
import { broadcast } from './runtime';

const logger = createLogger('site-service');

/** 读取全部站点，按用户排序返回。 */
export async function listSites(): Promise<SiteConfig[]> {
  return storage.getSites();
}

/** 读取单个站点。 */
export async function getSite(siteId: string): Promise<SiteConfig | null> {
  const sites = await storage.getSites();
  return sites.find((site) => site.id === siteId) ?? null;
}

/** 升级已有站点的主机权限：补充主域通配，确保能读取 domain=.example.com 的登录 Cookie。 */
export async function migrateSiteOrigins(): Promise<void> {
  const sites = await storage.getSites();
  let changed = false;
  const next = sites.map((site) => {
    const origins = collectSiteOrigins(site);
    const same =
      origins.length === site.origins.length && origins.every((origin) => site.origins.includes(origin));
    if (same) {
      return site;
    }
    changed = true;
    return { ...site, origins };
  });
  if (!changed) {
    return;
  }
  await storage.setSites(next);
  await broadcast({ kind: 'sites-updated', sites: next });
  logger.info('已升级站点主机权限（新增主域通配）', { count: next.length });
}

/** 新增或更新站点，返回最终配置。 */
export async function saveSite(draft: SiteDraft): Promise<SiteConfig> {
  const sites = await storage.getSites();
  const existing = draft.id ? sites.find((site) => site.id === draft.id) : undefined;
  const { site, warnings } = buildSiteConfig(draft, {
    id: existing?.id ?? draft.id,
    createdAt: existing?.createdAt,
    now: Date.now(),
  });

  if (existing) {
    const index = sites.findIndex((item) => item.id === existing.id);
    sites[index] = site;
    logger.info('更新站点', { siteId: site.id, name: site.name });
  } else {
    sites.push(site);
    logger.info('新增站点', { siteId: site.id, name: site.name });
  }

  await storage.setSites(sites);
  await broadcast({ kind: 'sites-updated', sites });
  if (warnings.length > 0) {
    logger.warn('站点配置存在风险项', warnings);
  }
  return site;
}

/** 删除站点，并清理会话、登录流程与快照。 */
export async function deleteSite(siteId: string): Promise<void> {
  const sites = await storage.getSites();
  const nextSites = sites.filter((site) => site.id !== siteId);
  if (nextSites.length === sites.length) {
    return;
  }
  await storage.setSites(nextSites);

  const sessions = await storage.getSessions();
  delete sessions[siteId];
  await storage.setSessions(sessions);

  const vault = await storage.getVault();
  if (vault[siteId]) {
    delete vault[siteId];
    await storage.setVault(vault);
  }

  const flows = await storage.getFlows();
  if (flows[siteId]) {
    delete flows[siteId];
    await storage.setFlows(flows);
  }

  logger.info('删除站点', { siteId });
  await broadcast({ kind: 'sites-updated', sites: nextSites });
}

/** 更新站点的关键 Cookie 配置（用于诊断后一键修复）。 */
export async function updateSessionCookies(
  siteId: string,
  cookieNames: string[],
): Promise<SiteConfig> {
  const sites = await storage.getSites();
  const site = sites.find((item) => item.id === siteId);
  if (!site) {
    throw new Error('站点不存在');
  }
  const normalized = normalizeCookieNames(cookieNames);
  if (normalized.length === 0) {
    throw new Error('请至少提供一个 Cookie 名称');
  }
  site.login.sessionCookieNames = normalized;
  site.updatedAt = Date.now();
  await storage.setSites(sites);
  await broadcast({ kind: 'sites-updated', sites });
  logger.info('更新关键 Cookie 配置', { siteId, cookieNames: normalized });
  return site;
}

/** 批量设置站点分组（用于分组重命名、删除、移动）。 */
export async function setSiteGroups(
  updates: Array<{ siteId: string; group?: string }>,
): Promise<SiteConfig[]> {
  const sites = await storage.getSites();
  const now = Date.now();
  updates.forEach(({ siteId, group }) => {
    const site = sites.find((item) => item.id === siteId);
    if (!site) {
      return;
    }
    site.group = group?.trim() || undefined;
    site.updatedAt = now;
  });
  await storage.setSites(sites);
  await broadcast({ kind: 'sites-updated', sites });
  logger.info('更新站点分组', { count: updates.length });
  return sites;
}

/** 启用/停用站点。 */
export async function setSiteEnabled(siteId: string, enabled: boolean): Promise<SiteConfig> {
  const sites = await storage.getSites();
  const site = sites.find((item) => item.id === siteId);
  if (!site) {
    throw new Error('站点不存在');
  }
  site.enabled = enabled;
  site.updatedAt = Date.now();
  await storage.setSites(sites);
  await broadcast({ kind: 'sites-updated', sites });
  logger.info('更新站点启用状态', { siteId, enabled });
  return site;
}

/** 导出站点 JSON。 */
export async function exportSites(): Promise<{ payload: string; filename: string }> {
  const sites = await storage.getSites();
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return {
    payload: serializeSites(sites),
    filename: `aggregate-sites-${stamp}.json`,
  };
}

/** 导入站点：replace = true 时整体替换，否则按 id 合并。 */
export async function importSites(payload: string, replace: boolean): Promise<SiteConfig[]> {
  const imported = parseSitesPayload(payload, Date.now());
  const existing = await storage.getSites();
  if (replace) {
    await storage.setSites(imported);
    logger.info('整体导入站点', { count: imported.length });
    await broadcast({ kind: 'sites-updated', sites: imported });
    return imported;
  }

  const byId = new Map(existing.map((site) => [site.id, site]));
  for (const site of imported) {
    byId.set(site.id, site);
  }
  const merged = [...byId.values()];
  await storage.setSites(merged);
  logger.info('合并导入站点', { count: imported.length, total: merged.length });
  await broadcast({ kind: 'sites-updated', sites: merged });
  return merged;
}

/** 找出已启用站点。 */
export async function getEnabledSites(): Promise<SiteConfig[]> {
  const sites = await storage.getSites();
  return sites.filter((site) => site.enabled);
}
