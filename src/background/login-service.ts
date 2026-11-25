/**
 * 扫码登录流程。
 *
 * 设计：站点登录页在独立弹窗中加载（保证 Cookie / 二维码脚本正常运行），
 * 面板每 2 秒轮询一次：
 * 1. 读取弹窗标签页 URL / 页面元素，判断是否登录成功；
 * 2. 读取关键 Cookie 的新增量，判断是否登录成功；
 * 3. 定位登录页二维码并截图回传给面板展示。
 *
 * 登录态本身由浏览器 Cookie 持久化，扩展只保存登录时间与过期时间。
 */
import { createLogger } from '../shared/logger';
import { detectAuthCookieChange, hasAllSessionCookies } from '../shared/session-utils';
import { storage } from '../shared/storage';
import { LOGIN_WINDOW } from '../shared/constants';
import type { LoginFlowState, PersistedLoginFlow, SiteConfig } from '../shared/types';
import {
  probeQrPage,
  clickPageElement,
  type QrProbeResult,
} from '../shared/injected/qr-probe';
import { compileUrlPattern, isLoginLikeUrl } from '../shared/url-utils';
import { assertSiteAccess } from './permissions';
import { broadcast, runtimeState } from './runtime';
import { checkSiteSession, markLoginSuccess, readSiteCookies } from './session-service';
import { saveVaultSnapshot } from './vault-service';

const logger = createLogger('login-service');

/** 防止同一站点并发轮询（面板 2 秒轮询 + 用户手动刷新）。 */
const inFlightPolls = new Map<string, Promise<LoginFlowState>>();

/** 持久化当前所有登录流程。 */
async function persistFlows(): Promise<void> {
  const flows: Record<string, PersistedLoginFlow> = {};
  for (const [siteId, flow] of runtimeState.persistedFlows) {
    flows[siteId] = flow;
  }
  await storage.setFlows(flows);
}

async function getSite(siteId: string): Promise<SiteConfig> {
  const sites = await storage.getSites();
  const site = sites.find((item) => item.id === siteId);
  if (!site) {
    throw new Error('站点不存在');
  }
  return site;
}

/** 记录打开登录窗口时已存在的关键 Cookie 值。 */
async function collectBaseline(site: SiteConfig): Promise<Record<string, string>> {
  const cookies = await readSiteCookies(site);
  const wanted = new Set(site.login.sessionCookieNames.map((name) => name.toLowerCase()));
  const baseline: Record<string, string> = {};
  for (const cookie of cookies) {
    if (wanted.has(cookie.name.toLowerCase())) {
      baseline[cookie.name.toLowerCase()] = cookie.value;
    }
  }
  return baseline;
}

/** 打开弹窗并开始扫码流程。 */
export async function startLogin(siteId: string): Promise<LoginFlowState> {
  const site = await getSite(siteId);
  await assertSiteAccess(site);

  // 先同步一次真实登录状态：浏览器中已登录时，面板应立即显示“已登录”。
  try {
    await checkSiteSession(site);
  } catch (error) {
    logger.warn('打开登录窗口前检测会话失败', { siteId, error: String(error) });
  }

  const existing = runtimeState.flows.get(siteId);
  if (existing && existing.status !== 'closed' && existing.status !== 'success') {
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, { focused: true }).catch(() => undefined);
    }
    return existing;
  }

  const baselineCookies = await collectBaseline(site);
  const win = await chrome.windows.create({
    url: site.login.loginUrl,
    type: 'popup',
    width: LOGIN_WINDOW.width,
    height: LOGIN_WINDOW.height,
    focused: true,
  });
  const tab = win.tabs?.[0];
  if (typeof win.id !== 'number' || typeof tab?.id !== 'number') {
    throw new Error('无法创建登录窗口');
  }

  const now = Date.now();
  const persisted: PersistedLoginFlow = {
    siteId,
    windowId: win.id,
    tabId: tab.id,
    startedAt: now,
    loginUrl: site.login.loginUrl,
    homepage: site.homepage,
    baselineCookies,
  };
  runtimeState.persistedFlows.set(siteId, persisted);
  await persistFlows();

  const state: LoginFlowState = {
    siteId,
    siteName: site.name,
    status: 'waiting',
    startedAt: now,
    updatedAt: now,
    windowId: win.id,
    tabId: tab.id,
    message: '请在登录窗口中扫码',
  };
  runtimeState.flows.set(siteId, state);
  await broadcast({ kind: 'login-state', state });
  logger.info('已打开登录窗口', { siteId, windowId: win.id, tabId: tab.id });
  return state;
}

/** 判断关键 Cookie 是否已完成一次新的登录。 */
function checkCookiesForSuccess(
  site: SiteConfig,
  cookies: Awaited<ReturnType<typeof readSiteCookies>>,
  baseline: Record<string, string>,
): string | null {
  const byName = new Map(cookies.map((cookie) => [cookie.name.toLowerCase(), cookie]));
  const configured = site.login.sessionCookieNames.map((name) => name.toLowerCase()).filter(Boolean);

  if (configured.length > 0) {
    const allPresent = configured.every((name) => (byName.get(name)?.value.length ?? 0) > 0);
    if (!allPresent) {
      return null;
    }
    const changed = configured.some((name) => {
      const current = byName.get(name)?.value;
      return baseline[name] === undefined || baseline[name] !== current;
    });
    return changed ? '已检测到新的登录凭证' : null;
  }

  if (site.login.autoDetectAuthCookie) {
    const detected = detectAuthCookieChange(Object.keys(baseline), cookies);
    if (detected.length > 0) {
      return `已检测到登录 Cookie（${detected[0]}）`;
    }
  }
  return null;
}

/** 页面或 URL 侧的登录成功判断。 */
function checkPageForSuccess(
  site: SiteConfig,
  tabUrl: string,
  probe: QrProbeResult | null,
): string | null {
  if (site.login.successSelector && probe?.successSelectorFound) {
    return '页面出现了登录成功标识';
  }
  const pattern = compileUrlPattern(site.login.successUrlPattern);
  if (pattern && pattern.test(tabUrl)) {
    return '已跳转到登录成功页面';
  }
  // 未配置任何判定规则时，离开登录页视为成功的辅助信号。
  if (
    !site.login.successUrlPattern &&
    site.login.sessionCookieNames.length === 0 &&
    tabUrl !== site.login.loginUrl
  ) {
    try {
      const current = new URL(tabUrl);
      const login = new URL(site.login.loginUrl);
      const leftLoginOrigin = current.origin !== login.origin;
      const leftLoginPath = current.pathname !== login.pathname && !/login|signin|passport|sso/i.test(current.pathname);
      if (leftLoginOrigin || leftLoginPath) {
        return '已离开登录页面';
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** 获取二维码截图（失败不影响主流程）。 */
async function captureQrScreenshot(
  state: LoginFlowState,
  probe: QrProbeResult | null,
): Promise<string | undefined> {
  if (!state.windowId || !probe?.crop) {
    return undefined;
  }
  try {
    return await chrome.tabs.captureVisibleTab(state.windowId, {
      format: 'jpeg',
      quality: 80,
    });
  } catch (error) {
    logger.debug('二维码截图失败', { siteId: state.siteId, error: String(error) });
    return undefined;
  }
}

async function finishSuccess(
  site: SiteConfig,
  state: LoginFlowState,
  reason: string,
  accountLabel?: string,
): Promise<LoginFlowState> {
  const settings = await storage.getSettings();
  await markLoginSuccess(site, accountLabel);

  if (settings.vaultEnabled) {
    try {
      await saveVaultSnapshot(site.id);
    } catch (error) {
      logger.warn('登录后自动备份凭证失败', { siteId: site.id, error: String(error) });
    }
  }

  const completed: LoginFlowState = {
    ...state,
    status: 'success',
    updatedAt: Date.now(),
    message: reason,
    accountLabel,
    qr: undefined,
  };
  runtimeState.flows.set(site.id, completed);
  runtimeState.persistedFlows.delete(site.id);
  await persistFlows();
  await broadcast({ kind: 'login-state', state: completed });

  if (settings.closeLoginWindowOnSuccess && state.windowId) {
    await chrome.windows.remove(state.windowId).catch(() => undefined);
  }
  logger.info('扫码登录完成', { siteId: site.id, reason });
  return completed;
}

/** 关闭（清理）流程状态。 */
async function closeFlow(
  siteId: string,
  status: LoginFlowState['status'],
  message?: string,
): Promise<LoginFlowState | null> {
  const state = runtimeState.flows.get(siteId);
  runtimeState.flows.delete(siteId);
  const persisted = runtimeState.persistedFlows.get(siteId);
  if (persisted) {
    runtimeState.persistedFlows.delete(siteId);
    await persistFlows();
  }
  if (!state) {
    return null;
  }
  const closed: LoginFlowState = {
    ...state,
    status,
    updatedAt: Date.now(),
    message,
    qr: undefined,
  };
  await broadcast({ kind: 'login-state', state: closed });
  return closed;
}

async function pollOnce(siteId: string): Promise<LoginFlowState> {
  const site = await getSite(siteId);
  const state = runtimeState.flows.get(siteId) ?? (await rebuildFromPersisted(site));
  if (!state) {
    throw new Error('登录流程已结束，请重新发起扫码');
  }
  if (state.status === 'success') {
    return state;
  }

  const persisted = runtimeState.persistedFlows.get(siteId);
  const tabId = state.tabId;
  const windowId = state.windowId;
  if (!tabId || !windowId) {
    return (await closeFlow(siteId, 'closed', '登录窗口已关闭')) ?? state;
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return (await closeFlow(siteId, 'closed', '登录窗口已关闭')) ?? state;
  }

  const tabUrl = tab.url ?? site.login.loginUrl;

  // 1) Cookie 判定（最可靠）
  const cookies = await readSiteCookies(site);
  const cookieReason = checkCookiesForSuccess(site, cookies, persisted?.baselineCookies ?? {});
  if (cookieReason) {
    return finishSuccess(site, state, cookieReason, tab.title?.slice(0, 40));
  }

  // 1.1) 浏览器中原本就存在有效登录态：登录页会自动跳转首页，此时关键 Cookie 不会变化，
  //      但已经离开登录页，直接复用现有登录态，避免面板一直停留在“未登录”。
  const reusedSession =
    site.login.sessionCookieNames.length > 0 &&
    hasAllSessionCookies(site.login.sessionCookieNames, cookies) &&
    !isLoginLikeUrl(tabUrl);
  if (reusedSession) {
    return finishSuccess(
      site,
      state,
      '浏览器中已存在有效登录态，已直接完成登录',
      tab.title?.slice(0, 40),
    );
  }

  // 2) 页面探测：登录成功标识 + 二维码
  let probe: QrProbeResult | null = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: probeQrPage,
      args: [
        {
          qrSelectors: [site.login.qrSelector ?? ''],
          successSelector: site.login.successSelector,
        },
      ],
    });
    const raw = results[0]?.result as QrProbeResult | undefined;
    probe = raw ?? null;
  } catch (error) {
    logger.debug('页面探测失败', { siteId, error: String(error) });
  }

  const pageReason = checkPageForSuccess(site, tabUrl, probe);
  if (pageReason) {
    return finishSuccess(site, state, pageReason, tab.title?.slice(0, 40));
  }

  // 3) 回传二维码
  let qr: LoginFlowState['qr'];
  if (probe?.found) {
    const screenshot = await captureQrScreenshot(state, probe);
    qr = {
      imageSrc: probe.imageSrc,
      screenshot,
      crop: probe.crop,
      capturedAt: Date.now(),
    };
  }

  const nextStatus: LoginFlowState['status'] = probe?.found ? 'waiting' : 'qr-missing';
  const message = probe?.found
    ? '等待扫码确认'
    : probe?.hasIframe
      ? '二维码可能位于内嵌框架，请在登录窗口中扫码'
      : '未识别到二维码，请在登录窗口中完成登录';

  const next: LoginFlowState = {
    ...state,
    status: nextStatus,
    updatedAt: Date.now(),
    qr,
    message,
  };
  runtimeState.flows.set(siteId, next);

  // 状态变化时广播，二维码更新依靠轮询返回，避免频繁传输截图。
  if (state.status !== next.status) {
    await broadcast({ kind: 'login-state', state: next });
  }
  return next;
}

/** 轮询登录状态（同一站点串行执行）。 */
export async function pollLogin(siteId: string): Promise<LoginFlowState> {
  const running = inFlightPolls.get(siteId);
  if (running) {
    return running;
  }
  const task = pollOnce(siteId).finally(() => {
    inFlightPolls.delete(siteId);
  });
  inFlightPolls.set(siteId, task);
  return task;
}

/** SW 重启后根据持久化信息恢复流程状态。 */
async function rebuildFromPersisted(site: SiteConfig): Promise<LoginFlowState | null> {
  const persisted = runtimeState.persistedFlows.get(site.id);
  if (!persisted) {
    return null;
  }
  const state: LoginFlowState = {
    siteId: site.id,
    siteName: site.name,
    status: 'waiting',
    startedAt: persisted.startedAt,
    updatedAt: Date.now(),
    windowId: persisted.windowId,
    tabId: persisted.tabId,
    message: '已恢复登录窗口',
  };
  runtimeState.flows.set(site.id, state);
  return state;
}

/** 取消登录并关闭窗口。 */
export async function cancelLogin(siteId: string): Promise<void> {
  const state = runtimeState.flows.get(siteId);
  const persisted = runtimeState.persistedFlows.get(siteId);
  const windowId = state?.windowId ?? persisted?.windowId;
  if (windowId) {
    await chrome.windows.remove(windowId).catch(() => undefined);
  }
  await closeFlow(siteId, 'closed', '已取消登录');
  logger.info('取消登录', { siteId });
}

/** 刷新登录页 / 点击站点自定义的刷新按钮。 */
export async function refreshLogin(siteId: string): Promise<LoginFlowState> {
  const site = await getSite(siteId);
  const state = runtimeState.flows.get(siteId);
  if (!state?.tabId) {
    throw new Error('登录窗口已关闭，请重新发起扫码');
  }
  let clicked = false;
  if (site.login.refreshButtonSelector) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: state.tabId },
        func: clickPageElement,
        args: [site.login.refreshButtonSelector],
      });
      clicked = Boolean(results[0]?.result);
    } catch (error) {
      logger.debug('点击刷新按钮失败', { siteId, error: String(error) });
    }
  }
  if (!clicked) {
    await chrome.tabs.reload(state.tabId);
  }
  const next: LoginFlowState = {
    ...state,
    status: 'waiting',
    updatedAt: Date.now(),
    qr: undefined,
    message: clicked ? '已点击页面刷新按钮' : '已重新加载二维码',
  };
  runtimeState.flows.set(siteId, next);
  await broadcast({ kind: 'login-state', state: next });
  return next;
}

/** 聚焦登录窗口。 */
export async function focusLogin(siteId: string): Promise<void> {
  const state = runtimeState.flows.get(siteId);
  if (!state?.windowId) {
    throw new Error('登录窗口已关闭');
  }
  await chrome.windows.update(state.windowId, { focused: true });
}

/** 处理窗口关闭事件：先做一次最终登录检测，再清理流程。 */
export async function handleWindowRemoved(windowId: number): Promise<void> {
  for (const [siteId, persisted] of [...runtimeState.persistedFlows]) {
    if (persisted.windowId !== windowId) {
      continue;
    }
    logger.info('登录窗口已关闭', { siteId, windowId });
    const site = await getSite(siteId).catch(() => null);
    const state = runtimeState.flows.get(siteId);
    if (site && state) {
      try {
        const cookies = await readSiteCookies(site);
        const reason = checkCookiesForSuccess(site, cookies, persisted.baselineCookies);
        if (reason) {
          await finishSuccess(site, state, reason);
          continue;
        }
        if (
          site.login.sessionCookieNames.length > 0 &&
          hasAllSessionCookies(site.login.sessionCookieNames, cookies)
        ) {
          await finishSuccess(site, state, '登录窗口关闭前检测到有效登录态');
          continue;
        }
      } catch (error) {
        logger.warn('窗口关闭后检测登录态失败', { siteId, error: String(error) });
      }
    }
    await closeFlow(siteId, 'closed', '登录窗口已关闭');
  }
}
