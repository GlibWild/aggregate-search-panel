/**
 * 登录凭证快照：加密保存站点的 Cookie，允许在登录失效后快速恢复。
 *
 * 安全提示：快照只在本地存储，且使用随机密钥加密；但密钥同样保存在
 * 扩展存储中，因此该功能默认关闭。
 */
import { decryptJson, encryptJson, generateVaultKey } from '../shared/crypto';
import { createLogger } from '../shared/logger';
import { storage } from '../shared/storage';
import type { CookieVaultEntry, SiteConfig } from '../shared/types';
import type { VaultStatusResult } from '../shared/messages';
import { checkSiteSession } from './session-service';

const logger = createLogger('vault-service');

interface SnapshotCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: chrome.cookies.SameSiteStatus;
  expirationDate?: number;
  storeId?: string;
}

function normalizeSameSite(
  value: chrome.cookies.SameSiteStatus | undefined,
): 'no_restriction' | 'lax' | 'strict' | undefined {
  if (value === 'no_restriction' || value === 'lax' || value === 'strict') {
    return value;
  }
  return undefined;
}

async function collectCookies(site: SiteConfig): Promise<SnapshotCookie[]> {
  const urls = [...new Set([site.homepage, site.login.loginUrl].filter(Boolean))];
  const result: SnapshotCookie[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    try {
      const list = await chrome.cookies.getAll({ url });
      for (const cookie of list) {
        const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        result.push({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: cookie.expirationDate,
          storeId: cookie.storeId,
        });
      }
    } catch (error) {
      logger.warn('备份时读取 Cookie 失败', { url, error: String(error) });
    }
  }
  return result;
}

async function getOrCreateKey(): Promise<string> {
  const existing = await storage.getVaultKey();
  if (existing) {
    return existing;
  }
  const key = generateVaultKey();
  await storage.setVaultKey(key);
  return key;
}

/** 备份指定站点的 Cookie。 */
export async function saveVaultSnapshot(siteId: string): Promise<VaultStatusResult> {
  const sites = await storage.getSites();
  const site = sites.find((item) => item.id === siteId);
  if (!site) {
    throw new Error('站点不存在');
  }
  const cookies = await collectCookies(site);
  if (cookies.length === 0) {
    throw new Error('没有可备份的 Cookie，请先完成登录');
  }
  const key = await getOrCreateKey();
  const encrypted = await encryptJson({ siteId, cookies }, key);
  const entry: CookieVaultEntry = {
    siteId,
    savedAt: Date.now(),
    count: cookies.length,
    cipher: encrypted.cipher,
    iv: encrypted.iv,
  };
  const vault = await storage.getVault();
  vault[siteId] = entry;
  await storage.setVault(vault);
  logger.info('已保存登录凭证快照', { siteId, count: entry.count });
  return { siteId, hasBackup: true, savedAt: entry.savedAt, count: entry.count };
}

/** 恢复最近的 Cookie 快照。 */
export async function restoreVaultSnapshot(
  siteId: string,
): Promise<{ restored: number; failed: number; total: number }> {
  const sites = await storage.getSites();
  const site = sites.find((item) => item.id === siteId);
  if (!site) {
    throw new Error('站点不存在');
  }
  const vault = await storage.getVault();
  const entry = vault[siteId];
  if (!entry) {
    throw new Error('该站点没有登录凭证快照');
  }
  const key = await storage.getVaultKey();
  if (!key) {
    throw new Error('本地加密密钥缺失，无法恢复');
  }
  const payload = await decryptJson<{ cookies: SnapshotCookie[] }>(
    { cipher: entry.cipher, iv: entry.iv },
    key,
  );

  let restored = 0;
  let failed = 0;
  const nowSeconds = Date.now() / 1000;
  for (const cookie of payload.cookies) {
    if (cookie.expirationDate && cookie.expirationDate <= nowSeconds) {
      failed += 1;
      continue;
    }
    const domain = cookie.domain.replace(/^\./, '');
    const url = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`;
    const details: chrome.cookies.SetDetails = {
      url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      storeId: cookie.storeId,
    };
    if (cookie.domain) {
      details.domain = cookie.domain;
    }
    const sameSite = normalizeSameSite(cookie.sameSite);
    if (sameSite) {
      details.sameSite = sameSite;
    }
    if (cookie.expirationDate) {
      details.expirationDate = cookie.expirationDate;
    }
    try {
      await chrome.cookies.set(details);
      restored += 1;
    } catch (error) {
      failed += 1;
      logger.warn('恢复 Cookie 失败', { siteId, name: cookie.name, error: String(error) });
    }
  }

  await checkSiteSession(site);
  logger.info('登录凭证快照恢复完成', { siteId, restored, failed });
  return { restored, failed, total: payload.cookies.length };
}

/** 删除快照。 */
export async function deleteVaultSnapshot(siteId: string): Promise<void> {
  const vault = await storage.getVault();
  if (!vault[siteId]) {
    return;
  }
  delete vault[siteId];
  await storage.setVault(vault);
  logger.info('已删除登录凭证快照', { siteId });
}

/** 查询快照状态。 */
export async function getVaultStatus(siteId: string): Promise<VaultStatusResult> {
  const vault = await storage.getVault();
  const entry = vault[siteId];
  if (!entry) {
    return { siteId, hasBackup: false };
  }
  return { siteId, hasBackup: true, savedAt: entry.savedAt, count: entry.count };
}
