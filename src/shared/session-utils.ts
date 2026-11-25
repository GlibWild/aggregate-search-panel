/**
 * 登录态判定逻辑（纯函数）。
 *
 * 判定顺序：
 * 1. 站点配置了关键 Cookie：全部存在且非空 => 在线，缺失 => 过期；
 * 2. 关键 Cookie 的过期时间 / 兜底 TTL 已过 => 过期；
 * 3. 无关键 Cookie 配置时，仅依赖 TTL，未配置 TTL 则保持“在线（无法验证）”。
 */

import { AUTH_COOKIE_PATTERN } from './constants';
import type { SessionStatus, SiteLoginConfig, SiteSession } from './types';

export interface CookieLike {
  name: string;
  value: string;
  expirationDate?: number;
}

export interface SessionEvaluation {
  status: SessionStatus;
  expiresAt?: number;
  message?: string;
}

export interface EvaluateSessionInput {
  login: SiteLoginConfig;
  session?: SiteSession;
  cookies: CookieLike[];
  now: number;
}

/** 非认证类 Cookie 名称白名单，避免误判。 */
const NON_AUTH_COOKIE_PATTERN =
  /(?:csrf|xsrf|_ga|_gid|_gat|lang|locale|theme|currency|device|fingerprint|utm|abtest|_ab|tracking|consent|notice|cookie_?policy)/i;

/**
 * 高置信度认证 Cookie 名称白名单（精确匹配，大小写不敏感）。
 * 用于用户未配置关键 Cookie、或配置的名称与站点实际不一致时兜底识别登录态。
 * 这里不使用高熵值判断，避免把 buvid3、_ga 等匿名/设备 Cookie 误判为登录。
 */
const STRONG_AUTH_COOKIE_NAMES = new Set([
  'sessdata',
  'z_c0',
  'sessionid',
  'web_session',
  'sub',
  'dbcl2',
  'bduss',
  'cookie2',
  'thor',
  'sess',
  'session',
  'sid',
  'token',
  'auth',
  'authorization',
  'access_token',
  'refresh_token',
  'ticket',
  'passport',
  'user_session',
  'uid',
  'userid',
  'user_id',
]);

/** 从 Cookie 列表中找出高置信度的认证 Cookie 名称。 */
export function detectStrongAuthCookies(cookies: CookieLike[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const cookie of cookies) {
    const key = cookie.name.toLowerCase();
    if (!cookie.value || seen.has(key)) {
      continue;
    }
    if (STRONG_AUTH_COOKIE_NAMES.has(key)) {
      seen.add(key);
      found.push(cookie.name);
    }
  }
  return found;
}


/** 判定一条 Cookie 是否像认证凭证。 */
export function looksLikeAuthCookie(cookie: CookieLike): boolean {
  if (!cookie.name || NON_AUTH_COOKIE_PATTERN.test(cookie.name)) {
    return false;
  }
  if (AUTH_COOKIE_PATTERN.test(cookie.name)) {
    return cookie.value.length > 0;
  }
  // 常见站点会使用无语义的短名字（如 z_c0、SUB），靠高熵长值兜底识别。
  return cookie.value.length >= 24 && /[A-Za-z0-9+/=_-]{24,}/.test(cookie.value);
}

/**
 * 对比登录前后的 Cookie 名称集合，找出新出现且疑似认证凭证的 Cookie。
 */
export function detectAuthCookieChange(
  baselineNames: string[],
  currentCookies: CookieLike[],
): string[] {
  const baseline = new Set(baselineNames.map((name) => name.toLowerCase()));
  return currentCookies
    .filter((cookie) => !baseline.has(cookie.name.toLowerCase()))
    .filter((cookie) => looksLikeAuthCookie(cookie))
    .map((cookie) => cookie.name);
}

/** 判断关键 Cookie 是否全部存在且非空。 */
export function hasAllSessionCookies(names: string[], cookies: CookieLike[]): boolean {
  const wanted = names.filter(Boolean);
  if (wanted.length === 0) {
    return false;
  }
  const byName = new Map(cookies.map((cookie) => [cookie.name.toLowerCase(), cookie]));
  return wanted.every((name) => {
    const cookie = byName.get(name.toLowerCase());
    return Boolean(cookie && cookie.value.length > 0);
  });
}

/** 依据配置与当前 Cookie 判定会话状态。 */
export function evaluateSession(input: EvaluateSessionInput): SessionEvaluation {
  const { login, session, cookies, now } = input;
  if (!session || !session.loginAt) {
    return { status: 'unknown', message: '尚未登录' };
  }

  const byName = new Map(cookies.map((cookie) => [cookie.name.toLowerCase(), cookie]));
  const configuredNames = login.sessionCookieNames.filter(Boolean);

  let expiresAt = session.expiresAt;
  if (login.sessionTtlMinutes && login.sessionTtlMinutes > 0) {
    const ttlExpiry = session.loginAt + login.sessionTtlMinutes * 60_000;
    expiresAt = expiresAt ? Math.min(expiresAt, ttlExpiry) : ttlExpiry;
  }

  if (configuredNames.length > 0) {
    const missing = configuredNames.filter((name) => {
      const cookie = byName.get(name.toLowerCase());
      return !cookie || cookie.value.length === 0;
    });
    if (missing.length > 0) {
      return {
        status: 'expired',
        expiresAt,
        message: `登录凭证已失效（${missing.join('、')}）`,
      };
    }
    // 关键 Cookie 仍存在时，以其真实过期时间为准。
    const expirations = configuredNames
      .map((name) => byName.get(name.toLowerCase())?.expirationDate)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (expirations.length > 0) {
      const cookieExpiry = Math.min(...expirations) * 1000;
      expiresAt = expiresAt ? Math.min(expiresAt, cookieExpiry) : cookieExpiry;
    }
  }

  if (expiresAt && now >= expiresAt) {
    return { status: 'expired', expiresAt, message: '登录已过期' };
  }

  return {
    status: 'active',
    expiresAt,
    message:
      configuredNames.length === 0
        ? '在线（未配置关键 Cookie，无法自动检测失效）'
        : '在线',
  };
}

/** 计算会话的兜底过期时间（毫秒时间戳）。 */
export function computeExpiresAt(loginAt: number, ttlMinutes?: number): number | undefined {
  if (!ttlMinutes || ttlMinutes <= 0) {
    return undefined;
  }
  return loginAt + ttlMinutes * 60_000;
}

/** 格式化会话状态为界面文案。 */
export function describeSessionStatus(status: SessionStatus): string {
  switch (status) {
    case 'active':
      return '已登录';
    case 'expired':
      return '登录已过期';
    case 'checking':
      return '检测中';
    case 'error':
      return '检测失败';
    default:
      return '未登录';
  }
}
