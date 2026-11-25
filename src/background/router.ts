/**
 * 消息路由：面板请求的统一入口。
 */
import { createLogger } from '../shared/logger';
import { isPanelRequest, type ApiResponse, type PanelRequest } from '../shared/messages';
import { storage } from '../shared/storage';
import { isHttpUrl } from '../shared/url-utils';
import {
  cancelLogin,
  focusLogin,
  pollLogin,
  refreshLogin,
  startLogin,
} from './login-service';
import { cancelSearch, startSearch } from './search-service';
import { checkAllSessions, checkSiteSession, diagnoseSiteSession, ensureSessionAlarm } from './session-service';
import {
  deleteSite,
  exportSites,
  getSite,
  importSites,
  saveSite,
  setSiteEnabled,
  setSiteGroups,
  updateSessionCookies,
} from './site-service';
import { runtimeState } from './runtime';
import {
  deleteVaultSnapshot,
  getVaultStatus,
  restoreVaultSnapshot,
  saveVaultSnapshot,
} from './vault-service';

const logger = createLogger('router');

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

function fail(error: unknown): ApiResponse<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function compactFlows(): Record<string, import('../shared/types').LoginFlowState> {
  const flows: Record<string, import('../shared/types').LoginFlowState> = {};
  for (const [siteId, state] of runtimeState.flows) {
    flows[siteId] = { ...state, qr: undefined };
  }
  return flows;
}

async function openUrl(url: string, newTab?: boolean): Promise<void> {
  if (!isHttpUrl(url)) {
    throw new Error('链接地址不合法');
  }
  const settings = await storage.getSettings();
  const shouldOpenNewTab = newTab ?? settings.openLinksInNewTab;
  if (shouldOpenNewTab) {
    await chrome.tabs.create({ url, active: true });
    return;
  }
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id) {
    await chrome.tabs.update(activeTab.id, { url });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
}

/** 处理单条面板请求。 */
export async function handleRequest(request: PanelRequest): Promise<ApiResponse> {
  try {
    switch (request.type) {
      case 'app:snapshot': {
        const snapshot = await storage.getSnapshot(compactFlows());
        return ok(snapshot);
      }
      case 'settings:update': {
        const current = await storage.getSettings();
        const next = { ...current, ...request.patch };
        await storage.setSettings(next);
        await ensureSessionAlarm();
        logger.info('更新设置', next);
        return ok(next);
      }
      case 'sites:save': {
        const site = await saveSite(request.draft);
        return ok(site);
      }
      case 'sites:delete': {
        const activeFlow = runtimeState.flows.get(request.siteId);
        if (activeFlow) {
          await cancelLogin(request.siteId);
        }
        await deleteSite(request.siteId);
        return ok(null);
      }
      case 'sites:set-enabled': {
        const site = await setSiteEnabled(request.siteId, request.enabled);
        return ok(site);
      }
      case 'sites:set-groups':
        return ok(await setSiteGroups(request.updates));
      case 'sites:export':
        return ok(await exportSites());
      case 'sites:import':
        return ok(await importSites(request.payload, request.replace));
      case 'sites:set-session-cookies':
        return ok(await updateSessionCookies(request.siteId, request.cookieNames));
      case 'sessions:check': {
        if (request.siteId) {
          const site = await getSite(request.siteId);
          if (!site) {
            throw new Error('站点不存在');
          }
          return ok(await checkSiteSession(site));
        }
        return ok({ sessions: await checkAllSessions() });
      }
      case 'sessions:diagnose': {
        const site = await getSite(request.siteId);
        if (!site) {
          throw new Error('站点不存在');
        }
        return ok(await diagnoseSiteSession(site));
      }
      case 'login:start':
        return ok(await startLogin(request.siteId));
      case 'login:poll':
        return ok(await pollLogin(request.siteId));
      case 'login:cancel':
        await cancelLogin(request.siteId);
        return ok(null);
      case 'login:refresh':
        return ok(await refreshLogin(request.siteId));
      case 'login:focus':
        await focusLogin(request.siteId);
        return ok(null);
      case 'search:run':
        return ok(await startSearch(request.keyword, request.siteIds, request.requestId));
      case 'search:cancel':
        await cancelSearch(request.requestId);
        return ok(null);
      case 'history:clear':
        await storage.setHistory([]);
        return ok(null);
      case 'vault:save':
        return ok(await saveVaultSnapshot(request.siteId));
      case 'vault:restore':
        return ok(await restoreVaultSnapshot(request.siteId));
      case 'vault:delete':
        await deleteVaultSnapshot(request.siteId);
        return ok(null);
      case 'vault:status':
        return ok(await getVaultStatus(request.siteId));
      case 'ui:open-url':
        await openUrl(request.url, request.newTab);
        return ok(null);
      default:
        return fail(new Error('未知的请求类型'));
    }
  } catch (error) {
    logger.error('处理请求失败', error, { type: request.type });
    return fail(error);
  }
}

/** 注册消息监听。 */
export function registerMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isPanelRequest(message)) {
      return false;
    }
    void handleRequest(message)
      .then(sendResponse)
      .catch((error) => {
        logger.error('消息处理异常', error);
        sendResponse(fail(error));
      });
    return true;
  });
}
