/**
 * 内置站点模板。
 *
 * 说明：站点结构与接口可能随时调整，模板只提供可用起点，
 * 用户可在“站点编辑”中覆盖任意选择器、Cookie 名称与地址。
 */
import type { SiteDraft } from './types';

export interface SitePreset {
  key: string;
  name: string;
  description: string;
  draft: SiteDraft;
}

function draft(base: Partial<SiteDraft> & Pick<SiteDraft, 'name' | 'homepage'>): SiteDraft {
  return {
    name: base.name,
    homepage: base.homepage,
    iconUrl: base.iconUrl,
    enabled: base.enabled ?? true,
    notes: base.notes,
    login: {
      loginUrl: base.login?.loginUrl ?? base.homepage,
      qrSelector: base.login?.qrSelector,
      refreshButtonSelector: base.login?.refreshButtonSelector,
      successUrlPattern: base.login?.successUrlPattern,
      successCookieName: base.login?.successCookieName,
      successSelector: base.login?.successSelector,
      sessionCookieNames: base.login?.sessionCookieNames ?? [],
      sessionTtlMinutes: base.login?.sessionTtlMinutes,
      autoDetectAuthCookie: base.login?.autoDetectAuthCookie ?? true,
    },
    search: {
      urlTemplate: base.search?.urlTemplate ?? `${base.homepage}?q={q}`,
      resultSelector: base.search?.resultSelector,
      titleSelector: base.search?.titleSelector,
      linkSelector: base.search?.linkSelector,
      snippetSelector: base.search?.snippetSelector,
      api: base.search?.api,
      maxResults: base.search?.maxResults,
      strategy: base.search?.strategy ?? 'auto',
      requiresLogin: base.search?.requiresLogin ?? true,
      sameSiteOnly: base.search?.sameSiteOnly ?? true,
      allowedDomains: base.search?.allowedDomains,
    },
  };
}

export const SITE_PRESETS: SitePreset[] = [
  {
    key: 'bilibili',
    name: '哔哩哔哩',
    description: '视频搜索结果，登录后可获取完整列表',
    draft: draft({
      name: '哔哩哔哩',
      homepage: 'https://www.bilibili.com',
      login: {
        loginUrl: 'https://passport.bilibili.com/login',
        successCookieName: 'SESSDATA',
        sessionCookieNames: ['SESSDATA'],
        sessionTtlMinutes: 60 * 24 * 14,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://search.bilibili.com/all?keyword={q}',
        strategy: 'tab',
        requiresLogin: true,
        allowedDomains: ['b23.tv'],
      },
    }),
  },
  {
    key: 'juejin',
    name: '掘金',
    description: '技术文章搜索，二维码登录',
    draft: draft({
      name: '掘金',
      homepage: 'https://juejin.cn',
      login: {
        loginUrl: 'https://juejin.cn/login',
        successCookieName: 'sessionid',
        sessionCookieNames: ['sessionid'],
        sessionTtlMinutes: 60 * 24 * 7,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://juejin.cn/search?query={q}',
        strategy: 'tab',
        requiresLogin: true,
      },
    }),
  },
  {
    key: 'weibo',
    name: '微博',
    description: '微博内容搜索，扫码登录',
    draft: draft({
      name: '微博',
      homepage: 'https://weibo.com',
      login: {
        loginUrl: 'https://weibo.com/login.php',
        successCookieName: 'SUB',
        sessionCookieNames: ['SUB'],
        sessionTtlMinutes: 60 * 24 * 7,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://s.weibo.com/weibo?q={q}',
        strategy: 'tab',
        requiresLogin: true,
        allowedDomains: ['weibo.cn'],
      },
    }),
  },
  {
    key: 'xiaohongshu',
    name: '小红书',
    description: '笔记搜索，扫码登录',
    draft: draft({
      name: '小红书',
      homepage: 'https://www.xiaohongshu.com',
      login: {
        loginUrl: 'https://www.xiaohongshu.com/login',
        successCookieName: 'web_session',
        sessionCookieNames: ['web_session'],
        sessionTtlMinutes: 60 * 24 * 7,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://www.xiaohongshu.com/search_result?keyword={q}',
        strategy: 'tab',
        requiresLogin: true,
        allowedDomains: ['xhslink.com'],
      },
    }),
  },
  {
    key: 'zhihu',
    name: '知乎',
    description: '问答与文章搜索（登录方式随站点调整）',
    draft: draft({
      name: '知乎',
      homepage: 'https://www.zhihu.com',
      login: {
        loginUrl: 'https://www.zhihu.com/signin',
        successCookieName: 'z_c0',
        sessionCookieNames: ['z_c0'],
        sessionTtlMinutes: 60 * 24 * 7,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://www.zhihu.com/search?type=content&q={q}',
        strategy: 'tab',
        requiresLogin: true,
      },
      notes: '知乎登录页可能只提供手机号/密码登录，扫码入口变化时可在弹窗内直接完成登录。',
    }),
  },
  {
    key: 'douban',
    name: '豆瓣',
    description: '书影音与小组内容搜索',
    draft: draft({
      name: '豆瓣',
      homepage: 'https://www.douban.com',
      login: {
        loginUrl: 'https://accounts.douban.com/passport/login',
        successCookieName: 'dbcl2',
        sessionCookieNames: ['dbcl2'],
        sessionTtlMinutes: 60 * 24 * 14,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://www.douban.com/search?q={q}',
        strategy: 'auto',
        requiresLogin: true,
      },
    }),
  },
  {
    key: 'baidupan',
    name: '百度网盘',
    description: '网盘文件搜索（需登录）',
    draft: draft({
      name: '百度网盘',
      homepage: 'https://pan.baidu.com',
      login: {
        loginUrl: 'https://passport.baidu.com/v2/?login&tpl=netdisk',
        successCookieName: 'BDUSS',
        sessionCookieNames: ['BDUSS'],
        sessionTtlMinutes: 60 * 24 * 30,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://pan.baidu.com/disk/main#/search?keyword={q}',
        strategy: 'tab',
        requiresLogin: true,
      },
    }),
  },
  {
    key: 'taobao',
    name: '淘宝',
    description: '商品搜索，扫码登录',
    draft: draft({
      name: '淘宝',
      homepage: 'https://www.taobao.com',
      login: {
        loginUrl: 'https://login.taobao.com/member/login.jhtml',
        successCookieName: 'cookie2',
        sessionCookieNames: ['cookie2'],
        sessionTtlMinutes: 60 * 24 * 7,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://s.taobao.com/search?q={q}',
        strategy: 'tab',
        requiresLogin: true,
        allowedDomains: ['tmall.com'],
      },
    }),
  },
  {
    key: 'jd',
    name: '京东',
    description: '商品搜索，扫码登录',
    draft: draft({
      name: '京东',
      homepage: 'https://www.jd.com',
      login: {
        loginUrl: 'https://passport.jd.com/new/login.aspx',
        successCookieName: 'thor',
        sessionCookieNames: ['thor'],
        sessionTtlMinutes: 60 * 24 * 7,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://search.jd.com/Search?keyword={q}',
        strategy: 'tab',
        requiresLogin: true,
        allowedDomains: ['3.cn'],
      },
    }),
  },
  {
    key: 'douyin',
    name: '抖音',
    description: '视频搜索，扫码登录',
    draft: draft({
      name: '抖音',
      homepage: 'https://www.douyin.com',
      login: {
        loginUrl: 'https://www.douyin.com',
        successCookieName: 'sessionid',
        sessionCookieNames: ['sessionid'],
        sessionTtlMinutes: 60 * 24 * 7,
        autoDetectAuthCookie: true,
      },
      search: {
        urlTemplate: 'https://www.douyin.com/search/{q}',
        strategy: 'tab',
        requiresLogin: true,
      },
    }),
  },
];

/** 按 key 查找模板。 */
export function findPreset(key: string): SitePreset | undefined {
  return SITE_PRESETS.find((preset) => preset.key === key);
}
