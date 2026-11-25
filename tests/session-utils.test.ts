import { describe, expect, it } from 'vitest';
import {
  computeExpiresAt,
  describeSessionStatus,
  detectAuthCookieChange,
  detectStrongAuthCookies,
  evaluateSession,
  hasAllSessionCookies,
  looksLikeAuthCookie,
  type CookieLike,
} from '../src/shared/session-utils';
import type { SiteLoginConfig } from '../src/shared/types';

function createLogin(overrides: Partial<SiteLoginConfig> = {}): SiteLoginConfig {
  return {
    loginUrl: 'https://example.com/login',
    sessionCookieNames: ['SESSDATA'],
    autoDetectAuthCookie: true,
    ...overrides,
  };
}

const now = 1_700_000_000_000;

describe('evaluateSession', () => {
  it('从未登录时返回 unknown', () => {
    const result = evaluateSession({
      login: createLogin(),
      cookies: [],
      now,
    });
    expect(result.status).toBe('unknown');
  });

  it('关键 Cookie 存在时判定为在线', () => {
    const result = evaluateSession({
      login: createLogin(),
      session: { siteId: 's1', status: 'active', loginAt: now - 60_000 },
      cookies: [{ name: 'SESSDATA', value: 'abc' }],
      now,
    });
    expect(result.status).toBe('active');
  });

  it('关键 Cookie 缺失时判定为过期，并提示缺失项', () => {
    const result = evaluateSession({
      login: createLogin(),
      session: { siteId: 's1', status: 'active', loginAt: now - 60_000 },
      cookies: [{ name: 'bili_jct', value: 'x' }],
      now,
    });
    expect(result.status).toBe('expired');
    expect(result.message).toContain('SESSDATA');
  });

  it('关键 Cookie 的过期时间早于当前时间时判定为过期', () => {
    const cookies: CookieLike[] = [
      { name: 'SESSDATA', value: 'abc', expirationDate: now / 1000 - 10 },
    ];
    const result = evaluateSession({
      login: createLogin(),
      session: { siteId: 's1', status: 'active', loginAt: now - 60_000 },
      cookies,
      now,
    });
    expect(result.status).toBe('expired');
    expect(result.expiresAt).toBe((now / 1000 - 10) * 1000);
  });

  it('兜底有效期过期时判定为过期', () => {
    const result = evaluateSession({
      login: createLogin({ sessionTtlMinutes: 60 }),
      session: { siteId: 's1', status: 'active', loginAt: now - 2 * 60 * 60_000 },
      cookies: [{ name: 'SESSDATA', value: 'abc' }],
      now,
    });
    expect(result.status).toBe('expired');
    expect(result.expiresAt).toBe(now - 60 * 60_000);
  });

  it('兜底有效期未到且 Cookie 有效时保持在线', () => {
    const loginAt = now - 10 * 60_000;
    const result = evaluateSession({
      login: createLogin({ sessionTtlMinutes: 60 }),
      session: { siteId: 's1', status: 'active', loginAt },
      cookies: [{ name: 'SESSDATA', value: 'abc' }],
      now,
    });
    expect(result.status).toBe('active');
    expect(result.expiresAt).toBe(loginAt + 60 * 60_000);
  });

  it('未配置关键 Cookie 时依赖 TTL，并提示无法自动检测', () => {
    const result = evaluateSession({
      login: createLogin({ sessionCookieNames: [] }),
      session: { siteId: 's1', status: 'active', loginAt: now - 1000 },
      cookies: [],
      now,
    });
    expect(result.status).toBe('active');
    expect(result.message).toContain('无法自动检测');
  });

  it('Cookie 名称大小写不敏感', () => {
    const result = evaluateSession({
      login: createLogin({ sessionCookieNames: ['sessdata'] }),
      session: { siteId: 's1', status: 'active', loginAt: now - 1000 },
      cookies: [{ name: 'SESSDATA', value: 'abc' }],
      now,
    });
    expect(result.status).toBe('active');
  });
});

describe('hasAllSessionCookies', () => {
  it('全部存在时返回 true，忽略名称大小写', () => {
    expect(
      hasAllSessionCookies(['SESSDATA', 'bili_jct'], [
        { name: 'sessdata', value: 'a' },
        { name: 'BILI_JCT', value: 'b' },
      ]),
    ).toBe(true);
  });

  it('任一缺失或值为空时返回 false', () => {
    expect(hasAllSessionCookies(['a', 'b'], [{ name: 'a', value: '1' }])).toBe(false);
    expect(hasAllSessionCookies(['a'], [{ name: 'a', value: '' }])).toBe(false);
    expect(hasAllSessionCookies([], [{ name: 'a', value: '1' }])).toBe(false);
  });
});

describe('认证 Cookie 识别', () => {
  it('只返回新增且疑似认证的 Cookie', () => {
    const current: CookieLike[] = [
      { name: 'SESSDATA', value: 'abc' },
      { name: 'z_c0', value: 'x'.repeat(40) },
      { name: '_ga', value: 'GA1.2.123' },
      { name: 'theme', value: 'dark' },
    ];
    expect(detectAuthCookieChange(['SESSDATA'], current)).toEqual(['z_c0']);
  });

  it('高置信度白名单能识别常见站点登录 Cookie', () => {
    expect(
      detectStrongAuthCookies([
        { name: 'SESSDATA', value: 'abc' },
        { name: 'bili_jct', value: 'x' },
        { name: 'DedeUserID', value: '123' },
        { name: 'buvid3', value: 'y'.repeat(40) },
      ]),
    ).toEqual(['SESSDATA']);
    expect(detectStrongAuthCookies([{ name: 'z_c0', value: 'token' }])).toEqual(['z_c0']);
    expect(detectStrongAuthCookies([{ name: 'web_session', value: 'token' }])).toEqual([
      'web_session',
    ]);
  });

  it('未登录站点的设备 Cookie 不会被误判', () => {
    expect(
      detectStrongAuthCookies([
        { name: 'buvid3', value: 'x'.repeat(40) },
        { name: 'buvid4', value: 'y'.repeat(40) },
        { name: 'bili_ticket', value: 'z'.repeat(40) },
        { name: 'b_nut', value: '123' },
        { name: '_ga', value: 'GA1.2.1' },
      ]),
    ).toEqual([]);
  });

  it('忽略空值并去重', () => {
    expect(
      detectStrongAuthCookies([
        { name: 'SESSDATA', value: '' },
        { name: 'sessionid', value: 'a' },
        { name: 'sessionid', value: 'b' },
      ]),
    ).toEqual(['sessionid']);
  });

  it('过滤常见的非认证 Cookie', () => {
    expect(looksLikeAuthCookie({ name: '_ga', value: 'x'.repeat(40) })).toBe(false);
    expect(looksLikeAuthCookie({ name: 'XSRF-TOKEN', value: 'x'.repeat(40) })).toBe(false);
    expect(looksLikeAuthCookie({ name: 'theme', value: 'dark' })).toBe(false);
    expect(looksLikeAuthCookie({ name: 'sessionid', value: 'abc' })).toBe(true);
  });

  it('基线中已存在的 Cookie 不重复判定', () => {
    expect(
      detectAuthCookieChange(['sessionid'], [{ name: 'sessionid', value: 'changed' }]),
    ).toEqual([]);
  });
});

describe('工具函数', () => {
  it('计算兜底过期时间', () => {
    expect(computeExpiresAt(1000, 10)).toBe(601_000);
    expect(computeExpiresAt(1000, undefined)).toBeUndefined();
    expect(computeExpiresAt(1000, 0)).toBeUndefined();
  });

  it('会话状态文案', () => {
    expect(describeSessionStatus('active')).toBe('已登录');
    expect(describeSessionStatus('expired')).toBe('登录已过期');
    expect(describeSessionStatus('unknown')).toBe('未登录');
  });
});
