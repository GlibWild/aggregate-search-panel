/**
 * 后台 Service Worker 入口。
 */
import { createLogger } from '../shared/logger';
import { storage } from '../shared/storage';
import { safeHostname } from '../shared/url-utils';
import { handleWindowRemoved, pollLogin } from './login-service';
import { restorePersistedFlows, runtimeState } from './runtime';
import { registerMessageRouter } from './router';
import { checkAllSessions, ensureSessionAlarm } from './session-service';
import { migrateSiteOrigins } from './site-service';

const logger = createLogger('background');

let initializing: Promise<void> | null = null;
let sessionCheckRunning: Promise<void> | null = null;

/** 初始化：补全设置、恢复登录流程、建立周期任务。可重复调用。 */
export function initialize(): Promise<void> {
  if (!initializing) {
    initializing = (async () => {
      const settings = await storage.getSettings();
      await storage.setSettings(settings);
      await migrateSiteOrigins();
      const flows = await storage.getFlows();
      await restorePersistedFlows(flows);
      await ensureSessionAlarm();
      try {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      } catch (error) {
        // 部分 Edge 版本不支持该行为设置，回退到 action.onClicked 打开侧边栏。
        logger.debug('setPanelBehavior 不可用', { error: String(error) });
      }
      logger.info('后台初始化完成', {
        flows: runtimeState.persistedFlows.size,
        checkMinutes: settings.sessionCheckMinutes,
      });
    })().catch((error) => {
      initializing = null;
      logger.error('后台初始化失败', error);
      throw error;
    });
  }
  return initializing;
}

function runSessionCheck(): void {
  if (sessionCheckRunning) {
    return;
  }
  sessionCheckRunning = checkAllSessions()
    .then(() => undefined)
    .catch((error) => {
      logger.error('周期检测登录态失败', error);
    })
    .finally(() => {
      sessionCheckRunning = null;
    });
}

/** 按站点串行、防抖地检查登录流程（Cookie 变化 / 页面跳转触发）。 */
const flowPollTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleFlowPoll(siteId: string, delayMs = 700): void {
  const existing = flowPollTimers.get(siteId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    flowPollTimers.delete(siteId);
    void pollLogin(siteId).catch((error) => {
      logger.debug('触发式轮询登录状态失败', { siteId, error: String(error) });
    });
  }, delayMs);
  flowPollTimers.set(siteId, timer);
}

/** Cookie 变化时，只对域名匹配的活跃登录流程触发检测。 */
function handleCookieChange(info: chrome.cookies.CookieChangeInfo): void {
  if (info.removed || runtimeState.persistedFlows.size === 0) {
    return;
  }
  const domain = info.cookie.domain.replace(/^\./, '').toLowerCase();
  if (!domain) {
    return;
  }
  for (const [siteId, flow] of runtimeState.persistedFlows) {
    const hostname = safeHostname(flow.homepage).toLowerCase();
    if (!hostname) {
      continue;
    }
    if (
      hostname === domain ||
      hostname.endsWith(`.${domain}`) ||
      domain.endsWith(`.${hostname}`)
    ) {
      scheduleFlowPoll(siteId);
    }
  }
}

/** 打开侧边栏；不支持 sidePanel API 时回退到独立标签页。 */
async function openPanel(windowId?: number): Promise<void> {
  try {
    if (typeof windowId === 'number' && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId });
      return;
    }
  } catch (error) {
    logger.warn('打开侧边栏失败，改用独立标签页', { error: String(error) });
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/index.html') });
}

// ---------- 事件注册 ----------
registerMessageRouter();

chrome.runtime.onInstalled.addListener((details) => {
  logger.info('扩展安装/更新', { reason: details.reason, version: chrome.runtime.getManifest().version });
  void initialize().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void initialize()
    .then(() => {
      // 启动后延迟检测，避免与浏览器启动争抢资源。
      setTimeout(() => runSessionCheck(), 5_000);
    })
    .catch(() => undefined);
});

chrome.action.onClicked.addListener((tab) => {
  void openPanel(tab.windowId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'agg-session-check') {
    void initialize()
      .then(() => runSessionCheck())
      .catch(() => undefined);
  }
});

chrome.cookies.onChanged.addListener((info) => {
  if (info.removed) {
    return;
  }
  // SW 冷启动时先恢复持久化的登录流程，再处理 Cookie 变化。
  void initialize()
    .then(() => handleCookieChange(info))
    .catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }
  void initialize()
    .then(() => {
      for (const [siteId, flow] of runtimeState.persistedFlows) {
        if (flow.tabId === tabId) {
          scheduleFlowPoll(siteId, 400);
        }
      }
    })
    .catch(() => undefined);
});

chrome.windows.onRemoved.addListener((windowId) => {
  void handleWindowRemoved(windowId);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith('agg-expired-')) {
    return;
  }
  void chrome.notifications.clear(notificationId);
  void chrome.windows
    .getLastFocused()
    .then((win) => openPanel(win.id))
    .catch(() => openPanel());
});

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  if (!notificationId.startsWith('agg-expired-')) {
    return;
  }
  void chrome.notifications.clear(notificationId);
  void chrome.windows
    .getLastFocused()
    .then((win) => openPanel(win.id))
    .catch(() => openPanel());
});

// Service Worker 每次冷启动都会执行顶层初始化（幂等）。
void initialize().catch(() => undefined);
