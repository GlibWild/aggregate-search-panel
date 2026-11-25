/**
 * offscreen 页面：使用 DOMParser 解析后台抓取到的 HTML。
 */
import { extractPageResults, type PageExtractOptions } from '../shared/injected/extract-results';

interface ParseRequest {
  type: 'offscreen:parse';
  html: string;
  options: PageExtractOptions;
}

function isParseRequest(message: unknown): message is ParseRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'offscreen:parse' &&
    typeof (message as { html?: unknown }).html === 'string'
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isParseRequest(message)) {
    return false;
  }
  try {
    const doc = new DOMParser().parseFromString(message.html, 'text/html');
    const results = extractPageResults(message.options, doc);
    sendResponse({ ok: true, results });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : '解析失败' });
  }
  return true;
});
