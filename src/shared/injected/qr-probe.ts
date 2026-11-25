/**
 * 登录二维码探测函数。
 *
 * 约束：会被注入页面执行，函数体内不得引用模块作用域变量。
 */

export interface QrProbeOptions {
  qrSelectors: string[];
  successSelector?: string;
}

export interface QrCropInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

export interface QrProbeResult {
  found: boolean;
  imageSrc?: string;
  crop?: QrCropInfo;
  pageUrl: string;
  pageTitle: string;
  hasIframe: boolean;
  qrHint?: string;
  successSelectorFound: boolean;
  passwordFormVisible: boolean;
  error?: string;
}

export function probeQrPage(options: QrProbeOptions): QrProbeResult {
  const pageUrl = location.href;
  const pageTitle = document.title;

  const isVisible = (node: Element): boolean => {
    const rect = node.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) {
      return false;
    }
    const style = getComputedStyle(node);
    const opacity = style.opacity === '' ? 1 : Number(style.opacity);
    return style.display !== 'none' && style.visibility !== 'hidden' && opacity > 0.05;
  };

  const probe: QrProbeResult = {
    found: false,
    pageUrl,
    pageTitle,
    hasIframe: document.querySelectorAll('iframe').length > 0,
    successSelectorFound: false,
    passwordFormVisible: false,
  };

  if (options.successSelector) {
    try {
      probe.successSelectorFound = Boolean(document.querySelector(options.successSelector));
    } catch {
      probe.successSelectorFound = false;
    }
  }

  probe.passwordFormVisible = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).some((input) => isVisible(input));

  const scored: Array<{ node: Element; score: number; priority: number }> = [];
  const seen = new Set<Element>();
  const addCandidate = (node: Element | null, score: number, priority: number): void => {
    if (!node || seen.has(node) || !isVisible(node)) {
      return;
    }
    seen.add(node);
    scored.push({ node, score, priority });
  };

  for (const selector of options.qrSelectors) {
    if (!selector || !selector.trim()) {
      continue;
    }
    let nodes: Element[] = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector.trim()));
    } catch {
      nodes = [];
    }
    for (const node of nodes) {
      addCandidate(node, 100, 0);
    }
  }

  if (scored.length === 0) {
    const genericSelectors = [
      'img[src*="qrcode" i]',
      'img[src*="qr" i]',
      'img[alt*="二维码"]',
      'img[alt*="扫码"]',
      'canvas[class*="qr" i]',
      'canvas[id*="qr" i]',
      '[class*="qrcode" i] img',
      '[class*="qrcode" i] canvas',
      '[id*="qrcode" i] img',
      '[id*="qrcode" i] canvas',
      '[class*="qrcode" i]',
      '[id*="qrcode" i]',
      '[class*="qr-code" i]',
      '[class*="qrCode" i]',
      '[class*="qr" i] img',
      '[class*="qr" i] canvas',
      '[class*="qr" i]',
    ];
    for (let index = 0; index < genericSelectors.length; index += 1) {
      let nodes: Element[] = [];
      try {
        nodes = Array.from(document.querySelectorAll(genericSelectors[index]));
      } catch {
        nodes = [];
      }
      for (const node of nodes) {
        addCandidate(node, 60 - index, 1);
      }
      if (scored.length >= 3) {
        break;
      }
    }
  }

  if (scored.length === 0) {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    for (const canvas of canvases) {
      addCandidate(canvas, 30, 2);
    }
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
    for (const image of images) {
      const rect = image.getBoundingClientRect();
      if (rect.width >= 96 && rect.height >= 96) {
        addCandidate(image, 10, 3);
      }
    }
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let best: { node: Element; score: number } | null = null;
  for (const candidate of scored) {
    const rect = candidate.node.getBoundingClientRect();
    // 二维码展示区域通常不会小于 72px，过小元素一律视为图标而非二维码。
    if (rect.width < 72 || rect.height < 72) {
      continue;
    }
    const ratio = rect.width / Math.max(1, rect.height);
    let score = candidate.score;
    if (ratio >= 0.75 && ratio <= 1.34) {
      score += 30;
    }
    if (rect.width >= 96 && rect.width <= 420) {
      score += 15;
    }
    if (rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight) {
      score += 10;
    }
    if (!best || score > best.score) {
      best = { node: candidate.node, score };
    }
  }

  if (!best) {
    return probe;
  }

  const node = best.node;
  const rect = node.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewportWidth, rect.right);
  const bottom = Math.min(viewportHeight, rect.bottom);
  if (right - left < 72 || bottom - top < 72) {
    return probe;
  }

  probe.found = true;
  probe.crop = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    viewportWidth,
    viewportHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  };

  try {
    if (node instanceof HTMLCanvasElement) {
      probe.imageSrc = node.toDataURL('image/png');
    } else if (node instanceof HTMLImageElement) {
      const src = node.currentSrc || node.src;
      if (src) {
        probe.imageSrc = src;
      }
    } else {
      const innerImage = node.querySelector('img');
      if (innerImage && innerImage.src) {
        probe.imageSrc = innerImage.src;
      } else {
        const innerCanvas = node.querySelector('canvas');
        if (innerCanvas) {
          probe.imageSrc = innerCanvas.toDataURL('image/png');
        }
      }
    }
  } catch (error) {
    probe.error = error instanceof Error ? error.message : '二维码读取失败';
  }

  // 提取二维码附近的提示文字（如“打开 App 扫码登录”）。
  let container: Element | null = node;
  for (let depth = 0; depth < 3 && container; depth += 1) {
    const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length >= 4 && text.length <= 80) {
      probe.qrHint = text;
      break;
    }
    container = container.parentElement;
  }

  return probe;
}

/** 在页面中点击匹配选择器的元素，返回是否点击成功。 */
export function clickPageElement(selector: string): boolean {
  if (!selector || !selector.trim()) {
    return false;
  }
  try {
    const element = document.querySelector(selector.trim());
    if (!element) {
      return false;
    }
    (element as HTMLElement).click();
    return true;
  } catch {
    return false;
  }
}

/** 检查页面是否已出现指定元素。 */
export function pageHasSelector(selector: string): boolean {
  if (!selector) {
    return false;
  }
  try {
    return Boolean(document.querySelector(selector));
  } catch {
    return false;
  }
}
