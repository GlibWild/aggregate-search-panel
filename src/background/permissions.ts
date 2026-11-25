/**
 * 主机权限检查。
 *
 * 扩展使用 optional_host_permissions，用户添加站点时才申请对应域权限，
 * 避免安装即读取所有站点数据。
 */
import { createLogger } from '../shared/logger';
import type { SiteConfig } from '../shared/types';

const logger = createLogger('permissions');

/** 判断扩展是否已获得站点所需的全部主机权限。 */
export async function hasSiteAccess(site: Pick<SiteConfig, 'origins'>): Promise<boolean> {
  if (!site.origins || site.origins.length === 0) {
    return true;
  }
  try {
    return await chrome.permissions.contains({ origins: site.origins });
  } catch (error) {
    logger.error('检查主机权限失败', error, { origins: site.origins });
    return false;
  }
}

/** 未授权时抛出统一错误。 */
export async function assertSiteAccess(site: SiteConfig): Promise<void> {
  const granted = await hasSiteAccess(site);
  if (!granted) {
    throw new Error(`尚未授权访问 ${site.name}，请在站点卡片上点击“授权访问”`);
  }
}
