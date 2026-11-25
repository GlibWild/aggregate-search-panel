/**
 * 搜索结果提取函数。
 *
 * 重要约束：该函数会被 chrome.scripting.executeScript 序列化后注入页面，
 * 因此函数体内不得引用模块作用域的任何变量/常量（只能使用参数与浏览器全局）。
 * 同文件导出供 offscreen 页面与单元测试直接调用。
 */

export interface PageExtractOptions {
  baseUrl: string;
  keyword: string;
  maxResults: number;
  resultSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
  snippetSelector?: string;
}

export interface RawPageResult {
  title: string;
  url: string;
  snippet: string;
}

export function extractPageResults(options: PageExtractOptions, rootDocument?: Document): RawPageResult[] {
  const doc: Document = rootDocument ?? globalThis.document;
  const compact = (text: string | null | undefined, limit: number): string => {
    const value = (text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
  };

  const toAbsolute = (href: string | null): string => {
    if (!href) {
      return '';
    }
    const raw = href.trim();
    if (!raw || raw.startsWith('javascript:') || raw.startsWith('mailto:') || raw.startsWith('#')) {
      return '';
    }
    try {
      const url = new URL(raw, options.baseUrl || doc.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return '';
      }
      url.hash = '';
      return url.toString();
    } catch {
      return '';
    }
  };

  const dedupeKey = (raw: string): string => {
    try {
      const url = new URL(raw);
      const kept = new URLSearchParams();
      for (const [key, value] of url.searchParams.entries()) {
        if (!/^(?:utm_|spm|from|share_|source$|_source)/i.test(key)) {
          kept.append(key, value);
        }
      }
      const query = kept.toString();
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}${query ? `?${query}` : ''}`;
    } catch {
      return raw;
    }
  };

  const ignoredTexts = [
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
    '设置',
    '登录/注册',
    '登录注册',
    '打开app',
    '打开APP',
  ];
  const isIgnoredText = (text: string): boolean => {
    const lower = text.toLowerCase().replace(/\s+/g, '');
    return ignoredTexts.some((item) => lower === item.toLowerCase().replace(/\s+/g, ''));
  };

  const isNoiseUrl = (url: string): boolean =>
    /(?:login|signin|sign-in|passport|register|signup|logout|javascript:|mailto:)/i.test(url) ||
    /(?:^|\.)accounts?\./i.test(new URL(url).hostname);

  const items: RawPageResult[] = [];
  const seen = new Set<string>();

  const push = (title: string, url: string, snippet: string): void => {
    const cleanTitle = compact(title, 180);
    const finalTitle = cleanTitle || url;
    if (finalTitle.length < 4) {
      return;
    }
    const key = dedupeKey(url);
    if (seen.has(key) || isNoiseUrl(url)) {
      return;
    }
    seen.add(key);
    items.push({ title: finalTitle, url, snippet: compact(snippet, 240) });
  };

  if (options.resultSelector) {
    let nodes: Element[] = [];
    try {
      nodes = Array.from(doc.querySelectorAll(options.resultSelector));
    } catch {
      nodes = [];
    }
    for (const node of nodes) {
      let link: HTMLAnchorElement | null = null;
      try {
        link = options.linkSelector
          ? (node.querySelector(options.linkSelector) as HTMLAnchorElement | null)
          : (node.querySelector('a[href]') as HTMLAnchorElement | null);
      } catch {
        link = null;
      }
      if (!link && node instanceof HTMLAnchorElement) {
        link = node;
      }
      const href = toAbsolute(link?.getAttribute('href') ?? null);
      if (!href) {
        continue;
      }
      let titleEl: Element | null = link;
      let snippetEl: Element | null = null;
      try {
        if (options.titleSelector) {
          titleEl = node.querySelector(options.titleSelector) ?? link;
        }
        if (options.snippetSelector) {
          snippetEl = node.querySelector(options.snippetSelector);
        }
      } catch {
        titleEl = link;
        snippetEl = null;
      }
      const titleText = compact(titleEl?.textContent, 180) || compact(node.textContent, 120);
      let snippetText = snippetEl ? compact(snippetEl.textContent, 240) : '';
      if (!snippetText) {
        const containerText = compact(node.textContent, 400);
        snippetText =
          titleText && containerText.startsWith(titleText)
            ? containerText.slice(titleText.length).trim()
            : containerText;
        if (snippetText === titleText) {
          snippetText = '';
        }
      }
      push(titleText, href, snippetText);
      if (items.length >= options.maxResults) {
        break;
      }
    }
    // 自定义选择器没有匹配到任何结果时，回退到通用启发式，避免站点改版后完全失效。
    if (items.length === 0) {
      return extractPageResults(
        {
          baseUrl: options.baseUrl,
          keyword: options.keyword,
          maxResults: options.maxResults,
        },
        doc,
      );
    }
    return items.slice(0, Math.max(1, options.maxResults));
  }

  // ---------- 通用启发式提取 ----------
  const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const candidates: Array<{ title: string; url: string; snippet: string; weight: number; order: number }> = [];

  anchors.forEach((anchor, order) => {
    let href = '';
    try {
      href = toAbsolute(anchor.getAttribute('href'));
    } catch {
      href = '';
    }
    if (!href) {
      return;
    }
    const rawTitle = compact(anchor.textContent, 180).replace(/^[#·•\-\s]+/, '');
    let title = rawTitle;
    // 图片卡片（如小红书、Pinterest）的链接通常只有封面图，标题在同级元素中。
    let card: Element | null = null;
    if (title.length < 6) {
      const cardSelectors = [
        'li',
        'article',
        'section',
        '[class*="note"]',
        '[class*="item"]',
        '[class*="card"]',
        '[class*="result"]',
      ];
      for (const selector of cardSelectors) {
        try {
          card = anchor.closest(selector);
        } catch {
          card = null;
        }
        if (card && card !== anchor) {
          break;
        }
      }
      if (card) {
        const headingSelectors = ['h1', 'h2', 'h3', 'h4', '[class*="title"]', '[class*="name"]'];
        let headingText = '';
        for (const selector of headingSelectors) {
          try {
            const heading = card.querySelector(selector);
            const text = compact(heading?.textContent, 180).replace(/^[#·•\-\s]+/, '');
            if (text.length >= 6) {
              headingText = text;
              break;
            }
          } catch {
            // 忽略不支持的选择器
          }
        }
        const imageAlt = compact(anchor.querySelector('img')?.getAttribute('alt') ?? '', 120);
        if (headingText.length >= 6 && !isIgnoredText(headingText)) {
          title = headingText;
        } else if (imageAlt.length >= 6 && !isIgnoredText(imageAlt)) {
          title = imageAlt;
        }
      }
    }
    if (title.length < 6 || isIgnoredText(title)) {
      return;
    }
    if (/^(?:javascript|mailto|tel):/i.test(href)) {
      return;
    }
    let noiseBox: Element | null = null;
    try {
      noiseBox = anchor.closest('nav, header, footer, [role="navigation"], [class*="nav" i], [class*="header" i]');
    } catch {
      noiseBox = null;
    }

    let container: Element = card ?? anchor;
    let snippet = '';
    let bestWeight = title.length + (href.includes(encodeURIComponent(options.keyword)) ? 8 : 0);
    if (card) {
      const cardText = compact(card.textContent, 500);
      if (cardText.length >= title.length + 8) {
        snippet = cardText.startsWith(title) ? cardText.slice(title.length).trim() : cardText;
        bestWeight = Math.max(bestWeight, title.length + Math.min(cardText.length, 160) / 4);
        card = null; // 已使用卡片容器，不再向上查找
      }
    }
    let element: Element | null = card ?? anchor;
    if (!snippet) {
      for (let depth = 0; depth < 5 && element; depth += 1) {
        const parent: Element | null = element.parentElement;
        if (!parent) {
          break;
        }
        element = parent;
        const text = compact(parent.textContent, 500);
        if (text.length >= title.length + 12 && text.length <= 500) {
          container = parent;
          snippet = text.startsWith(title) ? text.slice(title.length).trim() : text;
          bestWeight = Math.max(bestWeight, title.length + Math.min(text.length, 160) / 4);
          break;
        }
      }
    }

    let positiveBox: Element | null = null;
    try {
      positiveBox = anchor.closest('main, article, [role="main"], [class*="list" i], [class*="result" i], [class*="search" i]');
    } catch {
      positiveBox = null;
    }
    if (positiveBox) {
      bestWeight += 12;
    }
    if (noiseBox) {
      bestWeight -= 20;
    }
    try {
      const heading = container.querySelector('h1, h2, h3, h4, strong, b');
      if (heading) {
        bestWeight += 6;
      }
    } catch {
      // 忽略选择器异常
    }

    candidates.push({ title, url: href, snippet, weight: bestWeight, order });
  });

  candidates.sort((a, b) => b.weight - a.weight || a.order - b.order);
  for (const candidate of candidates) {
    push(candidate.title, candidate.url, candidate.snippet);
    if (items.length >= options.maxResults) {
      break;
    }
  }
  return items;
}
