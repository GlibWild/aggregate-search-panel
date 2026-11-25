import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  compactText,
  collectSiteOrigins,
  dedupeResults,
  displayHostname,
  encodeKeyword,
  filterResultsWithinSite,
  getBaseDomain,
  getOriginPattern,
  getOriginPatterns,
  getSiteScopeDomains,
  isHostUnderDomain,
  isHttpUrl,
  isLoginLikeUrl,
  isUrlWithinSiteScope,
  matchesUrlPattern,
  normalizeDomain,
  normalizeDomainList,
  normalizeKeyword,
  normalizeUrlForDedupe,
  safeHostname,
  toAbsoluteUrl,
} from '../src/shared/url-utils';
import type { SiteConfig } from '../src/shared/types';

describe('normalizeKeyword / encodeKeyword', () => {
  it('合并空白并去掉首尾空格', () => {
    expect(normalizeKeyword('  hello   world  ')).toBe('hello world');
  });

  it('对中文关键词做 URL 编码', () => {
    expect(encodeKeyword('人工智能 入门')).toBe(
      `${encodeURIComponent('人工智能')}%20${encodeURIComponent('入门')}`,
    );
  });
});

describe('buildSearchUrl', () => {
  it('替换 {q} 占位符', () => {
    expect(buildSearchUrl('https://example.com/search?q={q}', '前端')).toBe(
      `https://example.com/search?q=${encodeURIComponent('前端')}`,
    );
  });

  it('兼容 {query} 与 {keyword}', () => {
    expect(buildSearchUrl('https://a.com/?q={query}', 'react')).toBe('https://a.com/?q=react');
    expect(buildSearchUrl('https://a.com/?q={keyword}', 'react')).toBe('https://a.com/?q=react');
  });
});

describe('URL 校验与转换', () => {
  it('识别合法 http 地址', () => {
    expect(isHttpUrl('https://a.com/x')).toBe(true);
    expect(isHttpUrl('ftp://a.com/x')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });

  it('将相对链接转换为绝对链接', () => {
    expect(toAbsoluteUrl('/article/1', 'https://a.com/search?q=x')).toBe('https://a.com/article/1');
    expect(toAbsoluteUrl('javascript:void(0)', 'https://a.com')).toBe('');
  });

  it('识别登录页特征', () => {
    expect(isLoginLikeUrl('https://a.com/login?next=/')).toBe(true);
    expect(isLoginLikeUrl('https://passport.a.com/signin')).toBe(true);
    expect(isLoginLikeUrl('https://a.com/search?q=login')).toBe(false);
    expect(isLoginLikeUrl('https://a.com/article/1')).toBe(false);
  });

  it('安全提取主机名', () => {
    expect(safeHostname('https://www.example.com/a')).toBe('www.example.com');
    expect(safeHostname('broken')).toBe('');
    expect(displayHostname('https://www.example.com/a')).toBe('example.com');
  });
});

describe('权限来源推导', () => {
  it('从地址生成主机模式', () => {
    expect(getOriginPattern('https://www.zhihu.com/search?type=content&q={q}')).toBe(
      '*://www.zhihu.com/*',
    );
    expect(getOriginPattern('*://*.bilibili.com/*')).toBe('*://*.bilibili.com/*');
    expect(getOriginPattern('')).toBe('');
  });

  it('汇总站点的全部主机模式并去重（含主域通配）', () => {
    const origins = collectSiteOrigins({
      homepage: 'https://www.example.com',
      login: { loginUrl: 'https://passport.example.com/login' } as SiteConfig['login'],
      search: {
        urlTemplate: 'https://www.example.com/search?q={q}',
        api: { urlTemplate: 'https://api.example.com/search?q={q}' },
      } as SiteConfig['search'],
    });
    expect(origins).toEqual([
      '*://www.example.com/*',
      '*://*.example.com/*',
      '*://passport.example.com/*',
      '*://api.example.com/*',
    ]);
  });

  it('推导主域并展开通配权限', () => {
    expect(getBaseDomain('www.bilibili.com')).toBe('bilibili.com');
    expect(getBaseDomain('passport.bilibili.com')).toBe('bilibili.com');
    expect(getBaseDomain('bilibili.com')).toBe('bilibili.com');
    expect(getBaseDomain('www.example.com.cn')).toBe('example.com.cn');
    expect(getBaseDomain('127.0.0.1')).toBe('127.0.0.1');
    expect(getBaseDomain('localhost')).toBe('localhost');

    expect(getOriginPatterns('https://www.bilibili.com')).toEqual([
      '*://www.bilibili.com/*',
      '*://*.bilibili.com/*',
    ]);
    expect(getOriginPatterns('*://*.example.com/*')).toEqual(['*://*.example.com/*']);
    expect(getOriginPatterns('http://127.0.0.1:8080/a')).toEqual(['*://127.0.0.1/*']);
    expect(getOriginPatterns('')).toEqual([]);
  });
});

describe('结果去重与文本处理', () => {
  it('去除跟踪参数和 hash 后再去重', () => {
    expect(normalizeUrlForDedupe('https://a.com/x/?utm_source=feed&id=1#top')).toBe(
      'https://a.com/x?id=1',
    );
    const items = [
      { url: 'https://a.com/x?utm_source=1', title: 'A' },
      { url: 'https://a.com/x', title: 'B' },
      { url: 'https://a.com/y', title: 'C' },
    ];
    expect(dedupeResults(items).map((item) => item.title)).toEqual(['A', 'C']);
  });

  it('压缩空白并截断', () => {
    expect(compactText(' a   b \n c ', 100)).toBe('a b c');
    expect(compactText('abcdef', 3)).toBe('abc…');
  });

  it('安全匹配 URL 正则', () => {
    expect(matchesUrlPattern('^https://a\\.com/home', 'https://a.com/home')).toBe(true);
    expect(matchesUrlPattern('[invalid', 'https://a.com')).toBe(false);
    expect(matchesUrlPattern(undefined, 'https://a.com')).toBe(false);
  });
});

describe('站点结果域名过滤', () => {
  const site = {
    homepage: 'https://www.bilibili.com',
    login: { loginUrl: 'https://passport.bilibili.com/login' } as SiteConfig['login'],
    search: {
      urlTemplate: 'https://search.bilibili.com/all?keyword={q}',
      allowedDomains: ['b23.tv'],
    } as SiteConfig['search'],
  };

  it('允许主域与所有子域', () => {
    expect(isUrlWithinSiteScope('https://www.bilibili.com/video/1', site)).toBe(true);
    expect(isUrlWithinSiteScope('https://space.bilibili.com/123', site)).toBe(true);
    expect(isUrlWithinSiteScope('https://bilibili.com/', site)).toBe(true);
    expect(getSiteScopeDomains(site)).toContain('bilibili.com');
  });

  it('允许用户配置的额外域名', () => {
    expect(isUrlWithinSiteScope('https://b23.tv/abc', site)).toBe(true);
  });

  it('拒绝站外域名与伪装的相似域名', () => {
    expect(isUrlWithinSiteScope('https://evil.com/x', site)).toBe(false);
    expect(isUrlWithinSiteScope('https://bilibili.com.evil.com/x', site)).toBe(false);
    expect(isUrlWithinSiteScope('https://notbilibili.com/x', site)).toBe(false);
    expect(isUrlWithinSiteScope('not-a-url', site)).toBe(false);
  });

  it('批量过滤结果', () => {
    const items = [
      { url: 'https://www.bilibili.com/video/1', title: '站内' },
      { url: 'https://evil.com/ad', title: '广告' },
      { url: 'https://b23.tv/abc', title: '短链' },
    ];
    expect(filterResultsWithinSite(items, site).map((item) => item.title)).toEqual(['站内', '短链']);
  });
});

describe('域名规范化', () => {
  it('支持协议、通配符、端口与大小写', () => {
    expect(normalizeDomain('*.example.com')).toBe('example.com');
    expect(normalizeDomain('https://www.example.com/path')).toBe('www.example.com');
    expect(normalizeDomain('.example.com:8080')).toBe('example.com');
    expect(normalizeDomain('  ')).toBe('');
  });

  it('批量规范化并去重', () => {
    expect(normalizeDomainList('https://*.b23.tv/a, TMALL.com； B23.tv ')).toEqual([
      'b23.tv',
      'tmall.com',
    ]);
    expect(normalizeDomainList(undefined)).toEqual([]);
  });

  it('主机归属判断不误伤相似域名', () => {
    expect(isHostUnderDomain('a.example.com', 'example.com')).toBe(true);
    expect(isHostUnderDomain('example.com', 'example.com')).toBe(true);
    expect(isHostUnderDomain('example.com.evil.com', 'example.com')).toBe(false);
  });
});
