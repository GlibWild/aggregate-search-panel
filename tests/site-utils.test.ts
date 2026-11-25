import { describe, expect, it } from 'vitest';
import {
  buildSiteConfig,
  normalizeCookieNames,
  parseSitesPayload,
  serializeSites,
} from '../src/shared/site-utils';
import type { SiteDraft } from '../src/shared/types';

function createDraft(overrides: Partial<SiteDraft> = {}): SiteDraft {
  return {
    name: '示例站点',
    homepage: 'https://www.example.com',
    login: {
      loginUrl: 'https://www.example.com/login',
      sessionCookieNames: [],
      autoDetectAuthCookie: true,
    },
    search: {
      urlTemplate: 'https://www.example.com/search?q={q}',
      requiresLogin: true,
      strategy: 'auto',
    },
    ...overrides,
  };
}

describe('buildSiteConfig', () => {
  it('补齐默认值并推导主机权限', () => {
    const { site, warnings } = buildSiteConfig(createDraft(), { now: 1000 });
    expect(site.id).toMatch(/^site_/);
    expect(site.enabled).toBe(true);
    expect(site.createdAt).toBe(1000);
    expect(site.updatedAt).toBe(1000);
    expect(site.origins).toEqual(['*://www.example.com/*', '*://*.example.com/*']);
    expect(site.search.strategy).toBe('auto');
    expect(warnings.length).toBe(1);
  });

  it('把成功 Cookie 合并进关键 Cookie 列表', () => {
    const draft = createDraft({
      login: {
        loginUrl: 'https://www.example.com/login',
        successCookieName: 'SESSDATA',
        sessionCookieNames: ['bili_jct'],
        autoDetectAuthCookie: true,
      },
    });
    const { site, warnings } = buildSiteConfig(draft, { now: 1000 });
    expect(site.login.sessionCookieNames).toEqual(['bili_jct', 'SESSDATA']);
    expect(warnings).toEqual([]);
  });

  it('规范化 Cookie 名称（逗号/空格/分号分隔并去重）', () => {
    expect(normalizeCookieNames('a, b；c a，d')).toEqual(['a', 'b', 'c', 'd']);
    expect(normalizeCookieNames(['x', ' X ', '', 'y'])).toEqual(['x', 'y']);
  });

  it('限制结果数与有效期范围', () => {
    const draft = createDraft();
    draft.search.maxResults = 999;
    draft.login.sessionTtlMinutes = 0.2;
    const { site } = buildSiteConfig(draft, { now: 1000 });
    expect(site.search.maxResults).toBe(50);
    expect(site.login.sessionTtlMinutes).toBeUndefined();
  });

  it('默认开启同站过滤并规范化额外域名', () => {
    const draft = createDraft();
    draft.search.allowedDomains = ['b23.tv', 'https://b23.tv/x', ' B23.TV '];
    const { site } = buildSiteConfig(draft, { now: 1000 });
    expect(site.search.sameSiteOnly).toBe(true);
    expect(site.search.allowedDomains).toEqual(['b23.tv']);
  });

  it('校验必填字段', () => {
    expect(() => buildSiteConfig(createDraft({ name: '  ' }), { now: 1 })).toThrow('站点名称不能为空');
    expect(() =>
      buildSiteConfig(createDraft({ homepage: 'not-a-url' }), { now: 1 }),
    ).toThrow('站点主页必须是合法的 http/https 地址');
    expect(() =>
      buildSiteConfig(
        createDraft({ search: { urlTemplate: 'https://a.com/search', requiresLogin: true } }),
        { now: 1 },
      ),
    ).toThrow('搜索地址模板必须包含 {q} 占位符');
    expect(() =>
      buildSiteConfig(
        createDraft({
          login: {
            loginUrl: 'https://a.com/login',
            sessionCookieNames: [],
            autoDetectAuthCookie: true,
            successUrlPattern: '[invalid',
          },
        }),
        { now: 1 },
      ),
    ).toThrow('登录成功 URL 正则格式不正确');
  });
});

describe('导入导出', () => {
  it('序列化后可完整解析', () => {
    const { site } = buildSiteConfig(createDraft(), { now: 1000 });
    const payload = serializeSites([site]);
    const parsed = parseSitesPayload(payload, 5000);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('示例站点');
    expect(parsed[0].origins).toEqual(['*://www.example.com/*', '*://*.example.com/*']);
    expect(parsed[0].createdAt).toBe(1000);
  });

  it('支持纯数组格式并跳过无效项', () => {
    const { site } = buildSiteConfig(createDraft(), { now: 1000 });
    const text = JSON.stringify([
      site,
      { name: '缺地址' },
      { ...site, id: 'site_second', name: '第二个' },
    ]);
    const parsed = parseSitesPayload(text, 2000);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('示例站点');
    expect(parsed[1].name).toBe('第二个');
  });

  it('对非法内容给出明确错误', () => {
    expect(() => parseSitesPayload('not json', 1)).toThrow('导入内容不是合法的 JSON');
    expect(() => parseSitesPayload('{"foo":1}', 1)).toThrow('导入内容缺少 sites 数组');
    expect(() => parseSitesPayload('[{"name":"x"}]', 1)).toThrow('没有可导入的有效站点');
  });
});
