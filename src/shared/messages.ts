/**
 * 面板 <-> 后台 的消息协议。
 */
import type {
  AppSnapshot,
  LoginFlowState,
  SearchPhase,
  SearchResultItem,
  Settings,
  SiteConfig,
  SiteDraft,
  SiteSearchOutcome,
  SiteSession,
} from './types';

export type PanelRequest =
  | { type: 'app:snapshot' }
  | { type: 'settings:update'; patch: Partial<Settings> }
  | { type: 'sites:save'; draft: SiteDraft }
  | { type: 'sites:delete'; siteId: string }
  | { type: 'sites:set-enabled'; siteId: string; enabled: boolean }
  | { type: 'sites:set-groups'; updates: Array<{ siteId: string; group?: string }> }
  | { type: 'sites:export' }
  | { type: 'sites:import'; payload: string; replace: boolean }
  | { type: 'sites:set-session-cookies'; siteId: string; cookieNames: string[] }
  | { type: 'sessions:check'; siteId?: string }
  | { type: 'sessions:diagnose'; siteId: string }
  | { type: 'login:start'; siteId: string }
  | { type: 'login:poll'; siteId: string }
  | { type: 'login:cancel'; siteId: string }
  | { type: 'login:refresh'; siteId: string }
  | { type: 'login:focus'; siteId: string }
  | { type: 'search:run'; keyword: string; siteIds: string[]; requestId?: string }
  | { type: 'search:cancel'; requestId: string }
  | { type: 'history:clear' }
  | { type: 'vault:save'; siteId: string }
  | { type: 'vault:restore'; siteId: string }
  | { type: 'vault:delete'; siteId: string }
  | { type: 'vault:status'; siteId: string }
  | { type: 'ui:open-url'; url: string; newTab?: boolean };

/** 后台返回的会话详情（含用于展示的过期时间）。 */
export interface SessionCheckResult {
  sessions: Record<string, SiteSession>;
}

export interface LoginStartResult {
  state: LoginFlowState;
}

export interface VaultStatusResult {
  siteId: string;
  hasBackup: boolean;
  savedAt?: number;
  count?: number;
}

export interface ExportResult {
  payload: string;
  filename: string;
}

export interface SearchRunResult {
  requestId: string;
  queuedSiteIds: string[];
}

export type PanelResponseData =
  | AppSnapshot
  | Settings
  | SiteConfig
  | SiteConfig[]
  | SiteSession
  | SessionCheckResult
  | LoginFlowState
  | VaultStatusResult
  | SearchRunResult
  | ExportResult
  | SearchResultItem[]
  | null;

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: string;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiFailure;

/** 后台推送给面板的事件。 */
export type BackgroundEvent =
  | { kind: 'session-updated'; session: SiteSession }
  | { kind: 'login-state'; state: LoginFlowState }
  | { kind: 'search-progress'; requestId: string; siteId: string; phase: SearchPhase }
  | { kind: 'search-outcome'; requestId: string; outcome: SiteSearchOutcome }
  | { kind: 'search-done'; requestId: string; keyword: string; finishedAt: number }
  | { kind: 'sites-updated'; sites: SiteConfig[] }
  | { kind: 'toast'; level: 'info' | 'warn' | 'error'; message: string };

export interface EventMessage {
  type: 'agg:event';
  event: BackgroundEvent;
}

/** 判断任意消息是否为后台事件。 */
export function isEventMessage(message: unknown): message is EventMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'agg:event'
  );
}

/** 面板请求类型白名单。 */
const PANEL_REQUEST_TYPES = new Set<string>([
  'app:snapshot',
  'settings:update',
  'sites:save',
  'sites:delete',
  'sites:set-enabled',
  'sites:set-groups',
  'sites:export',
  'sites:import',
  'sites:set-session-cookies',
  'sessions:check',
  'sessions:diagnose',
  'login:start',
  'login:poll',
  'login:cancel',
  'login:refresh',
  'login:focus',
  'search:run',
  'search:cancel',
  'history:clear',
  'vault:save',
  'vault:restore',
  'vault:delete',
  'vault:status',
  'ui:open-url',
]);

/** 判断任意消息是否为面板请求。 */
export function isPanelRequest(message: unknown): message is PanelRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as { type?: unknown }).type === 'string' &&
    PANEL_REQUEST_TYPES.has((message as { type: string }).type)
  );
}

/** 统一发送请求到后台。 */
export async function sendRequest<T = unknown>(request: PanelRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as ApiResponse<T> | undefined;
  if (!response) {
    throw new Error('后台未响应，请重新加载扩展');
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.data;
}
