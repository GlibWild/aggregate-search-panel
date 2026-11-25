// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractPageResults } from '../src/shared/injected/extract-results';

function setBody(html: string): void {
  document.body.innerHTML = html;
  document.title = '测试页';
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('extractPageResults - 自定义选择器', () => {
  it('按容器与字段选择器提取', () => {
    setBody(`
      <div class="result">
        <h2 class="title">文章标题一</h2>
        <a class="link" href="/article/1">阅读</a>
        <p class="desc">这是摘要一</p>
      </div>
      <div class="result">
        <h2 class="title">文章标题二</h2>
        <a class="link" href="https://other.com/article/2">阅读</a>
        <p class="desc">摘要二</p>
      </div>
    `);
    const items = extractPageResults({
      baseUrl: 'https://www.example.com/search',
      keyword: '标题',
      maxResults: 10,
      resultSelector: '.result',
      titleSelector: '.title',
      linkSelector: '.link',
      snippetSelector: '.desc',
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: '文章标题一',
      url: 'https://www.example.com/article/1',
      snippet: '这是摘要一',
    });
    expect(items[1].url).toBe('https://other.com/article/2');
  });

  it('选择器非法时返回空数组，不抛异常', () => {
    setBody('<div class="result">x</div>');
    const items = extractPageResults({
      baseUrl: 'https://www.example.com',
      keyword: 'x',
      maxResults: 5,
      resultSelector: '[[invalid',
    });
    expect(items).toEqual([]);
  });
});

describe('extractPageResults - 通用启发式', () => {
  it('提取带标题的链接并忽略导航与登录链接', () => {
    setBody(`
      <header><a href="/">首页</a><a href="/login">登录</a></header>
      <main>
        <div class="search-list">
          <div class="item">
            <a href="/article/100">深入理解浏览器扩展开发</a>
            <p>扩展开发的完整指南与示例。</p>
          </div>
          <div class="item">
            <a href="/article/101">TypeScript 类型体操入门教程</a>
            <p>从零开始学习类型系统。</p>
          </div>
        </div>
      </main>
      <footer><a href="/about">关于我们</a></footer>
    `);
    const items = extractPageResults({
      baseUrl: 'https://www.example.com/search?q=扩展',
      keyword: '扩展',
      maxResults: 10,
    });
    const titles = items.map((item) => item.title);
    expect(titles).toContain('深入理解浏览器扩展开发');
    expect(titles).toContain('TypeScript 类型体操入门教程');
    expect(titles).not.toContain('登录');
    expect(titles).not.toContain('首页');
  });

  it('相对链接转换为绝对链接并去除 hash', () => {
    setBody(`
      <main>
        <a href="/post/1#comments">一篇足够长的文章标题</a>
        <a href="https://other.com/post/2">另一篇足够长的文章标题</a>
      </main>
    `);
    const items = extractPageResults({
      baseUrl: 'https://www.example.com/search',
      keyword: '文章',
      maxResults: 10,
    });
    const urls = items.map((item) => item.url);
    expect(urls).toContain('https://www.example.com/post/1');
    expect(urls).toContain('https://other.com/post/2');
  });

  it('按规范化 URL 去重', () => {
    setBody(`
      <main>
        <a href="/post/1?utm_source=feed">重复的结果标题需要足够长</a>
        <a href="/post/1">重复的结果标题需要足够长</a>
      </main>
    `);
    const items = extractPageResults({
      baseUrl: 'https://www.example.com/search',
      keyword: '重复',
      maxResults: 10,
    });
    expect(items).toHaveLength(1);
  });

  it('遵守结果数量上限', () => {
    setBody(
      `<main>${Array.from(
        { length: 8 },
        (_, index) => `<a href="/article/${index}">这是第 ${index} 篇足够长的文章标题</a>`,
      ).join('')}</main>`,
    );
    const items = extractPageResults({
      baseUrl: 'https://www.example.com/search',
      keyword: '文章',
      maxResults: 3,
    });
    expect(items).toHaveLength(3);
  });

  it('图片卡片链接可以从容器标题中取标题', () => {
    setBody(`
      <main>
        <section class="note-item">
          <a class="cover" href="/explore/1"><img alt="" /></a>
          <h2>小红书笔记标题一</h2>
          <div class="author">作者A</div>
        </section>
      </main>
    `);
    const items = extractPageResults({
      baseUrl: 'https://www.xiaohongshu.com/search_result?keyword=笔记',
      keyword: '笔记',
      maxResults: 5,
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('小红书笔记标题一');
    expect(items[0].url).toBe('https://www.xiaohongshu.com/explore/1');
  });

  it('自定义选择器匹配不到时回退到通用提取', () => {
    setBody(`
      <main>
        <a href="/article/9">站点改版后的普通结果标题</a>
      </main>
    `);
    const items = extractPageResults({
      baseUrl: 'https://www.example.com/search',
      keyword: '结果',
      maxResults: 5,
      resultSelector: '.old-layout-result',
    });
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://www.example.com/article/9');
  });

  it('没有可用链接时返回空数组', () => {
    setBody('<nav><a href="/">首页</a></nav>');
    const items = extractPageResults({
      baseUrl: 'https://www.example.com/search',
      keyword: 'x',
      maxResults: 10,
    });
    expect(items).toEqual([]);
  });
});
