import { describe, expect, it } from 'vitest';
import {
  getByPath,
  groupResultsBySite,
  mapApiResults,
  pushHistory,
  siteInitial,
} from '../src/shared/search-utils';
import type { SiteApiConfig, SiteConfig } from '../src/shared/types';

const api: SiteApiConfig = {
  urlTemplate: 'https://api.example.com/search?q={q}',
  method: 'GET',
  listPath: 'data.items',
  titlePath: 'title',
  linkPath: 'link',
  snippetPath: 'summary',
};

const site = {
  id: 'site_1',
  name: '示例',
  homepage: 'https://www.example.com',
  search: {} as SiteConfig['search'],
};

describe('getByPath', () => {
  it('读取嵌套字段与数组下标', () => {
    const data = { data: { items: [{ title: 'A' }, { title: 'B' }] } };
    expect(getByPath(data, 'data.items[1].title')).toBe('B');
    expect(getByPath(data, 'data.missing')).toBeUndefined();
    expect(getByPath(null, 'a.b')).toBeUndefined();
    expect(getByPath({ a: 1 }, '')).toEqual({ a: 1 });
  });
});

describe('mapApiResults', () => {
  it('映射标题、绝对链接与摘要', () => {
    const json = {
      data: {
        items: [
          { title: '文章一', link: '/article/1', summary: '摘要一' },
          { title: '文章二', link: 'https://other.com/a', summary: '' },
        ],
      },
    };
    const items = mapApiResults(json, api, site, 10);
    expect(items).toEqual([
      {
        siteId: 'site_1',
        siteName: '示例',
        title: '文章一',
        url: 'https://www.example.com/article/1',
        snippet: '摘要一',
      },
      {
        siteId: 'site_1',
        siteName: '示例',
        title: '文章二',
        url: 'https://other.com/a',
        snippet: '',
      },
    ]);
  });

  it('跳过缺少标题或链接的条目并去重', () => {
    const json = {
      data: {
        items: [
          { title: '', link: '/a' },
          { title: '有效', link: '/b' },
          { title: '重复', link: '/b?utm_source=x' },
        ],
      },
    };
    const items = mapApiResults(json, api, site, 10);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('有效');
  });

  it('遵守最大结果数限制', () => {
    const json = {
      data: {
        items: Array.from({ length: 10 }, (_, index) => ({
          title: `T${index}`,
          link: `/a/${index}`,
        })),
      },
    };
    expect(mapApiResults(json, api, site, 3)).toHaveLength(3);
  });

  it('列表路径不存在时返回空数组', () => {
    expect(mapApiResults({ data: {} }, api, site, 5)).toEqual([]);
    expect(mapApiResults(null, api, site, 5)).toEqual([]);
  });
});

describe('pushHistory', () => {
  it('去重、置顶并限制长度', () => {
    expect(pushHistory(['react', 'vue'], '  React  ')).toEqual(['React', 'vue']);
    expect(pushHistory([], '  ')).toEqual([]);
    const long = Array.from({ length: 30 }, (_, index) => `k${index}`);
    expect(pushHistory(long, 'new')).toHaveLength(30);
    expect(pushHistory(long, 'new')[0]).toBe('new');
  });
});

describe('groupResultsBySite', () => {
  it('按站点分组并保留顺序', () => {
    const groups = groupResultsBySite([
      { siteId: 'a', siteName: 'A', title: '1', url: 'https://a.com/1', snippet: '' },
      { siteId: 'b', siteName: 'B', title: '2', url: 'https://b.com/2', snippet: '' },
      { siteId: 'a', siteName: 'A', title: '3', url: 'https://a.com/3', snippet: '' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].siteName).toBe('B');
  });

  it('取站点名称首字母', () => {
    expect(siteInitial('哔哩哔哩')).toBe('哔');
    expect(siteInitial('  ')).toBe('?');
  });
});
