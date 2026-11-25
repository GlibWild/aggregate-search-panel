/**
 * 全局共享类型定义。
 *
 * 面板（side panel）、后台 Service Worker、注入脚本之间传递的所有数据结构
 * 均在此集中定义，避免多端协议漂移。
 */

/** 搜索结果抓取策略。auto = 先后台请求，失败或空结果时回退隐藏标签页。 */
export type SearchStrategy = 'auto' | 'fetch' | 'tab';

/** 单个站点的登录配置。 */
export interface SiteLoginConfig {
  /** 登录页地址（承载二维码的页面）。 */
  loginUrl: string;
  /** 二维码元素选择器，多个按顺序尝试；为空时使用通用自动识别。 */
  qrSelector?: string;
  /** 二维码已过期时页面内“刷新”按钮的选择器，可选。 */
  refreshButtonSelector?: string;
  /** 登录成功后的 URL 正则（字符串形式），命中即视为成功。 */
  successUrlPattern?: string;
  /** 登录成功后才会出现的 Cookie 名称，命中即视为成功。 */
  successCookieName?: string;
  /** 登录成功后才会出现的页面元素选择器，命中即视为成功。 */
  successSelector?: string;
  /** 代表登录态的关键 Cookie 名称，缺失即视为会话过期。建议至少配置一项。 */
  sessionCookieNames: string[];
  /** 兜底过期时间（分钟）。未配置时仅依赖 Cookie 检测。 */
  sessionTtlMinutes?: number;
  /** 是否在 Cookie 新增时尝试自动识别认证 Cookie（没有显式规则时生效）。 */
  autoDetectAuthCookie: boolean;
}

/** JSON 接口形式的搜索配置。 */
export interface SiteApiConfig {
  /** 接口地址模板，支持 {q} 占位符。 */
  urlTemplate: string;
  method: 'GET' | 'POST';
  /** POST 请求体模板，支持 {q} 占位符。 */
  bodyTemplate?: string;
  /** 请求头，值支持 {q} 占位符。 */
  headers?: Record<string, string>;
  /** 结果数组在 JSON 中的路径，例如 data.list。 */
  listPath: string;
  /** 单条结果的标题路径。 */
  titlePath: string;
  /** 单条结果的链接路径。 */
  linkPath: string;
  /** 单条结果的摘要路径，可选。 */
  snippetPath?: string;
}

/** 单站点的搜索配置。 */
export interface SiteSearchConfig {
  /** 搜索页地址模板，使用 {q} 占位符。 */
  urlTemplate: string;
  /** 结果条目容器选择器。留空则启用通用启发式提取。 */
  resultSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
  snippetSelector?: string;
  /** 可选的 JSON 接口配置（优先于 HTML 抓取）。 */
  api?: SiteApiConfig;
  /** 本站点最多保留的结果条数，默认取全局配置。 */
  maxResults?: number;
  /** 本站点抓取策略，默认取全局配置。 */
  strategy?: SearchStrategy;
  /** 是否必须先登录才有结果；未登录时直接提示扫码。 */
  requiresLogin: boolean;
  /** 是否只保留属于本站域名的结果（过滤广告、站外链接）。默认 true。 */
  sameSiteOnly?: boolean;
  /** 额外允许的域名（例如短链域名 b23.tv），仅在同站过滤开启时生效。 */
  allowedDomains?: string[];
}

/** 完整站点配置。 */
export interface SiteConfig {
  id: string;
  name: string;
  homepage: string;
  /** 站点图标地址，可选。 */
  iconUrl?: string;
  enabled: boolean;
  login: SiteLoginConfig;
  search: SiteSearchConfig;
  /** 需要向用户申请的主机权限来源，由 URL 自动推导。 */
  origins: string[];
  /** 搜索范围分组名称，可选。 */
  group?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** 新增/编辑站点时由 UI 提交的数据。 */
export interface SiteDraft {
  id?: string;
  name: string;
  homepage: string;
  iconUrl?: string;
  enabled?: boolean;
  login: SiteLoginConfig;
  search: SiteSearchConfig;
  group?: string;
  notes?: string;
}

export type SessionStatus = 'unknown' | 'checking' | 'active' | 'expired' | 'error';

/** 站点会话（登录态）元数据，不包含任何 Cookie 值。 */
export interface SiteSession {
  siteId: string;
  status: SessionStatus;
  /** 最近一次确认登录成功的时间。 */
  loginAt?: number;
  /** 最近一次检测时间。 */
  lastCheckedAt?: number;
  /** 预计过期时间，用于兜底提醒。 */
  expiresAt?: number;
  /** 页面可读的账号标识（如昵称），可选。 */
  accountLabel?: string;
  message?: string;
}

/** 二维码截图裁剪所需信息。 */
export interface QrCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

/** 二维码载体。 */
export interface QrCodePayload {
  /** 可直接作为 img src 使用的地址（data URL 或 http URL），可选。 */
  imageSrc?: string;
  /** 整窗截图 data URL，用于裁剪兜底，可选。 */
  screenshot?: string;
  crop?: QrCropRect;
  capturedAt: number;
}

export type LoginFlowStatus =
  | 'starting'
  | 'waiting'
  | 'qr-missing'
  | 'success'
  | 'closed'
  | 'error';

/** 登录流程对外状态。 */
export interface LoginFlowState {
  siteId: string;
  siteName: string;
  status: LoginFlowStatus;
  startedAt: number;
  updatedAt: number;
  windowId?: number;
  tabId?: number;
  qr?: QrCodePayload;
  message?: string;
  accountLabel?: string;
}

/** 站点登录态诊断结果（不包含任何 Cookie 值）。 */
export interface SiteSessionDiagnosis {
  siteId: string;
  siteName: string;
  status: SessionStatus;
  granted: boolean;
  homepage: string;
  loginUrl: string;
  configuredCookies: string[];
  matchedCookies: string[];
  detectedCookies: string[];
  cookieNames: string[];
  errors: string[];
  message?: string;
}

/** 搜索请求中的单站点进度阶段。 */
export type SearchPhase = 'queued' | 'requesting' | 'rendering' | 'parsing' | 'done';

export type SiteSearchStatus = 'ok' | 'empty' | 'login-required' | 'error' | 'cancelled';

/** 单站点搜索结果。 */
export interface SiteSearchOutcome {
  siteId: string;
  siteName: string;
  status: SiteSearchStatus;
  items: SearchResultItem[];
  durationMs: number;
  strategy?: 'api' | 'fetch' | 'tab';
  message?: string;
}

/** 归一化后的单条搜索结果。 */
export interface SearchResultItem {
  siteId: string;
  siteName: string;
  title: string;
  url: string;
  snippet: string;
}

/** 全局设置。 */
export interface Settings {
  maxResultsPerSite: number;
  /** 搜索结果中屏蔽的域名（含子域名）。 */
  blockedDomains?: string[];
  concurrency: number;
  defaultStrategy: SearchStrategy;
  notifyOnExpire: boolean;
  vaultEnabled: boolean;
  /** 搜索结果点击后是否在新标签页打开。 */
  openLinksInNewTab: boolean;
  /** 登录成功后是否自动关闭登录窗口。 */
  closeLoginWindowOnSuccess: boolean;
  /** 登录态检测间隔（分钟），用于周期检测。 */
  sessionCheckMinutes: number;
}

/** 加密后的登录凭证快照。 */
export interface CookieVaultEntry {
  siteId: string;
  savedAt: number;
  count: number;
  /** base64 编码的 AES-GCM 密文。 */
  cipher: string;
  /** base64 编码的 IV。 */
  iv: string;
}

/** 写入存储的登录流程（SW 重启后可恢复）。 */
export interface PersistedLoginFlow {
  siteId: string;
  windowId: number;
  tabId: number;
  startedAt: number;
  loginUrl: string;
  /** 站点主页地址缓存，用于按 Cookie 域名匹配登录流程。 */
  homepage: string;
  /** 打开登录窗口时已存在的关键 Cookie 值，用于判断是否完成了一次新登录。 */
  baselineCookies: Record<string, string>;
}

export interface AppSnapshot {
  sites: SiteConfig[];
  sessions: Record<string, SiteSession>;
  settings: Settings;
  history: string[];
  flows: Record<string, LoginFlowState>;
}
