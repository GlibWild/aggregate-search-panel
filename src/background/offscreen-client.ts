/**
 * offscreen 文档管理：Service Worker 没有 DOMParser，HTML 解析交给 offscreen 页面。
 */
import { createLogger } from '../shared/logger';
import type { PageExtractOptions, RawPageResult } from '../shared/injected/extract-results';

const logger = createLogger('offscreen');

interface ParseResponse {
  ok: boolean;
  results?: RawPageResult[];
  error?: string;
}

let creating: Promise<void> | null = null;

async function hasDocument(): Promise<boolean> {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    });
    return contexts.length > 0;
  } catch {
    return false;
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasDocument()) {
    return;
  }
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: '解析站点搜索页 HTML 并提取搜索结果',
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Only a single offscreen')) {
          throw error;
        }
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

/** 在 offscreen 页面中解析 HTML 并提取结果。 */
export async function parseHtmlInOffscreen(
  html: string,
  options: PageExtractOptions,
): Promise<RawPageResult[]> {
  await ensureOffscreenDocument();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('解析页面超时')), 8_000);
  });

  const request = chrome.runtime.sendMessage({
    type: 'offscreen:parse',
    html,
    options,
  }) as Promise<ParseResponse | undefined>;

  const response = await Promise.race([request, timeout]);
  if (!response) {
    throw new Error('解析器无响应');
  }
  if (!response.ok) {
    throw new Error(response.error ?? '解析页面失败');
  }
  logger.debug('offscreen 解析完成', { count: response.results?.length ?? 0 });
  return response.results ?? [];
}
