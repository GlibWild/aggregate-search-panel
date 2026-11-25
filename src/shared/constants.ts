import type { Settings } from './types';

/** 存储键集中管理，避免散落的字符串。 */
export const STORAGE_KEYS = {
  sites: 'agg.sites',
  sessions: 'agg.sessions',
  settings: 'agg.settings',
  flows: 'agg.flows',
  history: 'agg.history',
  vaultKey: 'agg.vaultKey',
  vault: 'agg.vault',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  maxResultsPerSite: 12,
  concurrency: 3,
  defaultStrategy: 'auto',
  notifyOnExpire: true,
  vaultEnabled: false,
  openLinksInNewTab: true,
  closeLoginWindowOnSuccess: true,
  sessionCheckMinutes: 5,
};

/** 登录窗口尺寸。 */
export const LOGIN_WINDOW = {
  width: 480,
  height: 760,
} as const;

/** 单站点搜索超时（毫秒）。 */
export const SEARCH_TIMEOUT_MS = 30_000;

/** 登录弹窗内页面渲染等待时间（毫秒）。 */
export const LOGIN_RENDER_DELAY_MS = 1_200;

/** 面板轮询登录状态的间隔（毫秒）。 */
export const LOGIN_POLL_INTERVAL_MS = 2_000;

/** 自动识别认证 Cookie 使用的名称特征。 */
export const AUTH_COOKIE_PATTERN =
  /(?:sess|session|token|auth|ticket|passport|credential|jwt|sso|login|uid|user_?id|account)/i;

/** 判定为登录页的 URL 特征。 */
export const LOGIN_URL_PATTERN =
  /(?:^|[\/._-])(?:login|signin|sign-in|logon|passport|sso|oauth|authorize|auth)(?:[\/._-]|$)|account\/login/i;

/** 二维码可能出现的常见属性特征。 */
export const QR_ATTR_PATTERN = /(?:qr|qrcode|erweima|scan|code)/i;

/** 通用结果提取时忽略的链接文本。 */
export const IGNORED_LINK_TEXTS = [
  '登录',
  '注册',
  '首页',
  '上一页',
  '下一页',
  '更多',
  '帮助',
  '关于',
  '隐私',
  '协议',
  '客户端',
  '下载',
  '反馈',
];
