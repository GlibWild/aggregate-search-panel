/**
 * 面板通用工具。
 */
import type { LoginFlowState, SiteSession } from '../shared/types';
import type { CSSProperties } from 'react';

/** 将错误转换为可展示文案。 */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** 格式化为 HH:mm。 */
export function formatClock(timestamp?: number): string {
  if (!timestamp) {
    return '—';
  }
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 格式化为 M月D日 HH:mm。 */
export function formatDateTime(timestamp?: number): string {
  if (!timestamp) {
    return '—';
  }
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(timestamp)}`;
}

/** 距今的简短描述。 */
export function formatRelative(timestamp?: number): string {
  if (!timestamp) {
    return '';
  }
  const diff = Date.now() - timestamp;
  if (diff < 0) {
    return formatRemaining(-diff);
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.floor(hours / 24)} 天前`;
}

/** 剩余时长描述。 */
export function formatRemaining(milliseconds: number): string {
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes <= 0) {
    return '已到期';
  }
  if (minutes < 60) {
    return `${minutes} 分钟后`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时后`;
  }
  return `${Math.floor(hours / 24)} 天后`;
}

export type SessionTone = 'ok' | 'warn' | 'danger' | 'muted';

export interface SessionSummary {
  label: string;
  tone: SessionTone;
  detail: string;
}

/** 把会话状态转换为展示文案。 */
export function summarizeSession(session?: SiteSession): SessionSummary {
  if (!session) {
    return { label: '未登录', tone: 'muted', detail: '点击“扫码登录”后再搜索' };
  }
  switch (session.status) {
    case 'active': {
      const expiry = session.expiresAt
        ? `预计 ${formatRemaining(session.expiresAt - Date.now())}到期`
        : '登录态由浏览器 Cookie 维持';
      return {
        label: '已登录',
        tone: 'ok',
        detail: session.loginAt
          ? `${formatDateTime(session.loginAt)} 登录 · ${expiry}`
          : expiry,
      };
    }
    case 'expired':
      return {
        label: '登录已过期',
        tone: 'danger',
        detail: session.message ?? '请重新扫码登录',
      };
    case 'checking':
      return { label: '检测中', tone: 'muted', detail: '正在检查登录状态' };
    case 'error':
      return { label: '检测失败', tone: 'warn', detail: session.message ?? '请检查站点权限' };
    default:
      return { label: '未登录', tone: 'muted', detail: session.message ?? '点击“扫码登录”后再搜索' };
  }
}

/** 下载文本文件。 */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/** 验证站点主机的可选权限申请。 */
export async function requestSitePermission(origins: string[]): Promise<boolean> {
  if (origins.length === 0) {
    return true;
  }
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

/** 查询站点授权状态。 */
export async function querySitePermission(origins: string[]): Promise<boolean> {
  if (origins.length === 0) {
    return true;
  }
  try {
    return await chrome.permissions.contains({ origins });
  } catch {
    return false;
  }
}

/** 引用登录流程中的二维码图片。 */
export function qrImageSource(flow: LoginFlowState): string | undefined {
  return flow.qr?.imageSrc;
}

/**
 * 计算二维码截图的背景样式：
 * 截图是整个窗口的截图，需要按裁剪区域偏移并缩放。
 */
export function qrScreenshotStyle(flow: LoginFlowState, size: number): CSSProperties | null {
  const qr = flow.qr;
  if (!qr?.screenshot || !qr.crop) {
    return null;
  }
  const { x, y, width, viewportWidth, viewportHeight, devicePixelRatio } = qr.crop;
  const scale = size / Math.max(1, width);
  return {
    width: `${size}px`,
    height: `${size}px`,
    backgroundImage: `url("${qr.screenshot}")`,
    backgroundSize: `${viewportWidth * devicePixelRatio * scale}px ${viewportHeight * devicePixelRatio * scale}px`,
    backgroundPosition: `${-x * devicePixelRatio * scale}px ${-y * devicePixelRatio * scale}px`,
    backgroundRepeat: 'no-repeat',
  };
}

/** 取站点域名首字母作为图标回退（与共享实现保持一致）。 */
export { siteInitial } from '../shared/search-utils';

/** 根据名称生成稳定的渐变色。 */
export function siteTone(name: string): string {
  const palette = ['#4f8cff', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#eab308'];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }
  return palette[hash % palette.length];
}

/** 校验搜索模板占位符。 */
export function hasSearchPlaceholder(template: string): boolean {
  return /\{q\}|\{query\}|\{keyword\}/i.test(template);
}
