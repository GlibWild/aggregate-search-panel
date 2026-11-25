/**
 * 登录态检测与过期提醒。
 */
import { createLogger } from '../shared/logger';
import { computeExpiresAt, detectStrongAuthCookies, evaluateSession, hasAllSessionCookies, type CookieLike } from '../shared/session-utils';
import { storage } from '../shared/storage';
import type { SiteConfig, SiteSession, SiteSessionDiagnosis } from '../shared/types';
import { hasSiteAccess } from './permissions';
import { broadcast, runtimeState } from './runtime';

const logger = createLogger('session-service');

/** 会话写入串行队列。 */
let sessionWriteChain: Promise<void> = Promise.resolve();

/** 合并首页与登录页可见的 Cookie（去重）。 */
export async function readSiteCookies(site: SiteConfig): Promise<CookieLike[]> {
  const detailed = await readSiteCookiesDetailed(site);
  return detailed.cookies;
}

/** 读取站点 Cookie，同时收集读取错误（供诊断使用）。 */
export async function readSiteCookiesDetailed(
  site: SiteConfig,
): Promise<{ cookies: CookieLike[]; errors: string[] }> {
  const urls = [...new Set([site.homepage, site.login.loginUrl].filter(Boolean))];
  const cookies: CookieLike[] = [];
  const errors: string[] = [];
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
        cookies.push({
          name: cookie.name,
          value: cookie.value,
          expirationDate: cookie.expirationDate,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${url}: ${message}`);
      logger.warn('读取 Cookie 失败', { url, error: message });
    }
  }
  return { cookies, errors };
}

/** 判断关键 Cookie 是否全部存在。 */

async function persistSession(session: SiteSession): Promise<void> {
  // 串行写入，避免并发检测时 read-modify-write 覆盖其他站点的结果。
  sessionWriteChain = sessionWriteChain
    .then(async () => {
      const sessions = await storage.getSessions();
      sessions[session.siteId] = session;
      await storage.setSessions(sessions);
    })
    .catch((error) => {
      logger.error('保存会话状态失败', error, { siteId: session.siteId });
    });
  await sessionWriteChain;
  await broadcast({ kind: 'session-updated', session });
}

/** 检测单个站点的登录态。 */
export async function checkSiteSession(site: SiteConfig): Promise<SiteSession> {
  const now = Date.now();
  const sessions = await storage.getSessions();
  let session = sessions[site.id];

  if (!(await hasSiteAccess(site))) {
    const failed: SiteSession = {
      siteId: site.id,
      status: 'error',
      lastCheckedAt: now,
      message: '尚未授权访问该站点',
    };
    await persistSession(failed);
    return failed;
  }

  const { cookies } = await readSiteCookiesDetailed(site);
  const configured = site.login.sessionCookieNames;

  // 配置的关键 Cookie 找不到时，用高置信度白名单兜底识别，
  // 兼容用户未填写关键 Cookie，或站点实际 Cookie 名称与配置不一致的情况。
  let effectiveLogin = site.login;
  let autoMessage: string | undefined;
  if (!hasAllSessionCookies(configured, cookies)) {
    const detected = detectStrongAuthCookies(cookies);
    if (detected.length > 0) {
      effectiveLogin = { ...site.login, sessionCookieNames: detected };
      autoMessage =
        configured.length === 0
          ? `未配置关键 Cookie，已自动识别：${detected.slice(0, 3).join('、')}`
          : `关键 Cookie（${configured.slice(0, 3).join('、')}）未找到，已按自动识别的 ${detected.slice(0, 3).join('、')} 判定`;
      logger.info('使用自动识别的登录 Cookie', { siteId: site.id, detected, configured });
    }
  }
  const effectiveNames = effectiveLogin.sessionCookieNames;

  // 首次使用但浏览器中已有登录态时，直接认领为“在线”。
  if ((!session || !session.loginAt) && hasAllSessionCookies(effectiveNames, cookies)) {
    const loginAt = now;
    session = {
      siteId: site.id,
      status: 'active',
      loginAt,
      lastCheckedAt: now,
      expiresAt: computeExpiresAt(loginAt, site.login.sessionTtlMinutes),
    };
  }

  const evaluation = evaluateSession({
    login: effectiveLogin,
    session,
    cookies,
    now,
  });

  const next: SiteSession = {
    siteId: site.id,
    status: evaluation.status,
    loginAt: session?.loginAt,
    lastCheckedAt: now,
    expiresAt: evaluation.expiresAt,
    accountLabel: session?.accountLabel,
    message: autoMessage ?? evaluation.message,
  };

  if (autoMessage && next.status === 'active') {
    logger.info('已通过自动识别的 Cookie 判定登录态', { siteId: site.id, autoMessage });
  }

  const changed =
    !session ||
    session.status !== next.status ||
    session.expiresAt !== next.expiresAt ||
    session.message !== next.message;

  if (changed) {
    logger.info('登录态变化', { siteId: site.id, status: next.status, message: next.message });
  }

  await persistSession(next);
  if (next.status === 'expired') {
    await maybeNotifyExpired(site, next);
  } else if (next.status === 'active') {
    runtimeState.notifiedExpiry.delete(site.id);
  }
  return next;
}

/** 诊断站点登录态：返回权限、读取到的 Cookie 名称与自动识别结果，便于排查“未登录”问题。 */
export async function diagnoseSiteSession(site: SiteConfig): Promise<SiteSessionDiagnosis> {
  const now = Date.now();
  const granted = await hasSiteAccess(site);
  const { cookies, errors } = await readSiteCookiesDetailed(site);
  const configured = site.login.sessionCookieNames;
  const matched = configured.filter((name) => hasAllSessionCookies([name], cookies));
  const detected = detectStrongAuthCookies(cookies);
  const effectiveNames = hasAllSessionCookies(configured, cookies)
    ? configured
    : detected.length > 0
      ? detected
      : configured;
  const sessions = await storage.getSessions();
  const evaluation = evaluateSession({
    login: { ...site.login, sessionCookieNames: effectiveNames },
    session: sessions[site.id],
    cookies,
    now,
  });
  const cookieNames = [...new Set(cookies.map((cookie) => cookie.name))].sort((a, b) =>
    a.localeCompare(b),
  );
  logger.info('登录态诊断完成', {
    siteId: site.id,
    granted,
    cookieCount: cookies.length,
    configured,
    detected,
    status: evaluation.status,
  });
  return {
    siteId: site.id,
    siteName: site.name,
    status: evaluation.status,
    granted,
    homepage: site.homepage,
    loginUrl: site.login.loginUrl,
    configuredCookies: configured,
    matchedCookies: matched,
    detectedCookies: detected,
    cookieNames,
    errors,
    message: evaluation.message,
  };
}

/** 检测全部站点（限制并发，避免集中读取 Cookie）。 */export async function checkAllSessions(): Promise<Record<string, SiteSession>> {
  const sites = await storage.getSites();
  const limit = 3;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, sites.length) }, async () => {
    while (cursor < sites.length) {
      const site = sites[cursor];
      cursor += 1;
      try {
        await checkSiteSession(site);
      } catch (error) {
        logger.error('检测站点登录态失败', error, { siteId: site.id });
      }
    }
  });
  await Promise.all(workers);
  return storage.getSessions();
}

/** 记录一次成功的扫码登录。 */
export async function markLoginSuccess(
  site: SiteConfig,
  accountLabel?: string,
): Promise<SiteSession> {
  const now = Date.now();
  const session: SiteSession = {
    siteId: site.id,
    status: 'active',
    loginAt: now,
    lastCheckedAt: now,
    expiresAt: computeExpiresAt(now, site.login.sessionTtlMinutes),
    accountLabel,
    message: '扫码登录成功',
  };
  runtimeState.notifiedExpiry.delete(site.id);
  await persistSession(session);
  logger.info('登录成功', { siteId: site.id, siteName: site.name });
  return session;
}

/** 触发过期通知（同一次失效只提醒一次）。 */
export async function maybeNotifyExpired(site: SiteConfig, session: SiteSession): Promise<void> {
  const settings = await storage.getSettings();
  if (!settings.notifyOnExpire || runtimeState.notifiedExpiry.has(site.id)) {
    return;
  }
  runtimeState.notifiedExpiry.add(site.id);
  try {
    await chrome.notifications.create(`agg-expired-${site.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '登录已过期',
      message: `${site.name} 的登录已过期，请重新扫码${session.message ? `（${session.message}）` : ''}`,
      priority: 2,
      buttons: [{ title: '打开面板重新扫码' }],
    });
    logger.info('已发送过期通知', { siteId: site.id });
  } catch (error) {
    logger.warn('发送过期通知失败', { siteId: site.id, error: String(error) });
  }
}

/** 建立周期检测任务（已存在且周期一致时保留，避免频繁重置延迟）。 */
export async function ensureSessionAlarm(): Promise<void> {
  const settings = await storage.getSettings();
  const period = Math.max(1, Math.min(120, settings.sessionCheckMinutes));
  const existing = await chrome.alarms.get('agg-session-check');
  if (existing && existing.periodInMinutes === period) {
    return;
  }
  await chrome.alarms.clear('agg-session-check');
  chrome.alarms.create('agg-session-check', {
    delayInMinutes: 1,
    periodInMinutes: period,
  });
  logger.info('登录态检测任务已重建', { periodInMinutes: period });
}
