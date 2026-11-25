/**
 * 后台运行时状态与事件广播。
 */
import { createLogger } from '../shared/logger';
import type { BackgroundEvent } from '../shared/messages';
import { storage } from '../shared/storage';
import type { LoginFlowState, PersistedLoginFlow } from '../shared/types';

const logger = createLogger('runtime');

export const runtimeState = {
  /** 内存中的登录流程状态（含二维码图片）。 */
  flows: new Map<string, LoginFlowState>(),
  /** 持久化的登录窗口信息，用于 Service Worker 重启后恢复。 */
  persistedFlows: new Map<string, PersistedLoginFlow>(),
  /** 进行中的搜索任务。 */
  searchControllers: new Map<string, AbortController>(),
  /** 已提醒过过期的站点，避免重复通知。 */
  notifiedExpiry: new Set<string>(),
};

/** 向所有扩展页面广播事件（没有接收者时静默忽略）。 */
export async function broadcast(event: BackgroundEvent): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'agg:event', event });
  } catch {
    // 面板未打开时没有接收者，属于正常情况。
  }
}

/** 广播一条提示。 */
export async function notifyToast(
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  await broadcast({ kind: 'toast', message, level });
}

/**
 * 从存储恢复登录流程（SW 重启后调用），丢弃已经关闭的窗口。
 */
export async function restorePersistedFlows(
  loaded: Record<string, PersistedLoginFlow>,
): Promise<void> {
  if (Object.keys(loaded).length === 0) {
    return;
  }
  const sites = await storage.getSites();
  const nameById = new Map(sites.map((site) => [site.id, site.name]));

  for (const [siteId, flow] of Object.entries(loaded)) {
    try {
      const win = await chrome.windows.get(flow.windowId);
      if (!win) {
        continue;
      }
      runtimeState.persistedFlows.set(siteId, {
        ...flow,
        baselineCookies: flow.baselineCookies ?? {},
      });
      if (!runtimeState.flows.has(siteId)) {
        const now = Date.now();
        runtimeState.flows.set(siteId, {
          siteId,
          siteName: nameById.get(siteId) ?? siteId,
          status: 'waiting',
          startedAt: flow.startedAt,
          updatedAt: now,
          windowId: flow.windowId,
          tabId: flow.tabId,
          message: '已恢复登录窗口',
        });
      }
    } catch {
      logger.debug('丢弃已失效的登录窗口', { siteId, windowId: flow.windowId });
    }
  }
}
