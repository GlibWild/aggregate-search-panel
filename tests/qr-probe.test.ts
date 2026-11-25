// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clickPageElement, pageHasSelector, probeQrPage } from '../src/shared/injected/qr-probe';

function mockRect(element: Element, x: number, y: number, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      x,
      y,
      left: x,
      top: y,
      width,
      height,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({}),
    }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = '登录';
});

describe('probeQrPage', () => {
  it('按自定义选择器定位二维码并返回图片与裁剪区域', () => {
    document.body.innerHTML = `
      <div class="login-box">
        <div class="qr"><img src="https://cdn.example.com/qr.png" alt="二维码" /></div>
      </div>
    `;
    const image = document.querySelector('img')!;
    mockRect(image, 40, 60, 200, 200);

    const probe = probeQrPage({ qrSelectors: ['.qr img'] });
    expect(probe.found).toBe(true);
    expect(probe.imageSrc).toBe('https://cdn.example.com/qr.png');
    expect(probe.crop).toMatchObject({ x: 40, y: 60, width: 200, height: 200 });
    expect(probe.passwordFormVisible).toBe(false);
  });

  it('识别 canvas 并导出 dataURL', () => {
    document.body.innerHTML = '<canvas class="login-qr"></canvas>';
    const canvas = document.querySelector('canvas')!;
    mockRect(canvas, 10, 10, 160, 160);
    canvas.toDataURL = vi.fn(() => 'data:image/png;base64,AAAA');

    const probe = probeQrPage({ qrSelectors: ['canvas.login-qr'] });
    expect(probe.found).toBe(true);
    expect(probe.imageSrc).toBe('data:image/png;base64,AAAA');
  });

  it('页面没有二维码时返回 found=false', () => {
    document.body.innerHTML = '<form><input type="password" /></form>';
    const probe = probeQrPage({ qrSelectors: ['.nothing'] });
    expect(probe.found).toBe(false);
    expect(probe.pageTitle).toBe('登录');
    expect(probe.hasIframe).toBe(false);
  });

  it('暴露 iframe、成功选择器与密码框状态', () => {
    document.body.innerHTML = `
      <div class="user-avatar"></div>
      <input type="password" />
    `;
    const input = document.querySelector('input')!;
    mockRect(input, 10, 10, 200, 50);

    // happy-dom 禁止 iframe 页面加载，用 spy 模拟页面中存在 iframe。
    const original = document.querySelectorAll.bind(document);
    const spy = vi.spyOn(document, 'querySelectorAll').mockImplementation(((
      selector: string,
    ) => {
      if (selector === 'iframe') {
        return [document.createElement('div')] as unknown as NodeListOf<Element>;
      }
      return original(selector);
    }) as typeof document.querySelectorAll);

    const probe = probeQrPage({
      qrSelectors: [],
      successSelector: '.user-avatar',
    });
    expect(probe.found).toBe(false);
    expect(probe.hasIframe).toBe(true);
    expect(probe.successSelectorFound).toBe(true);
    expect(probe.passwordFormVisible).toBe(true);
    spy.mockRestore();
  });

  it('尺寸过小的图片不会被当作二维码', () => {
    document.body.innerHTML = '<img src="https://cdn.example.com/logo.png" />';
    const image = document.querySelector('img')!;
    mockRect(image, 0, 0, 40, 40);

    const probe = probeQrPage({ qrSelectors: ['img'] });
    expect(probe.found).toBe(false);
  });

  it('非法选择器不会抛异常', () => {
    document.body.innerHTML = '<div></div>';
    const probe = probeQrPage({ qrSelectors: ['[[bad'], successSelector: '[[bad' });
    expect(probe.found).toBe(false);
    expect(probe.successSelectorFound).toBe(false);
  });
});

describe('页面操作辅助函数', () => {
  it('点击匹配元素', () => {
    document.body.innerHTML = '<button id="refresh">刷新</button>';
    const button = document.querySelector('button')!;
    const handler = vi.fn();
    button.addEventListener('click', handler);

    expect(clickPageElement('#refresh')).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(clickPageElement('#missing')).toBe(false);
    expect(clickPageElement('')).toBe(false);
  });

  it('检查元素是否存在', () => {
    document.body.innerHTML = '<div class="online"></div>';
    expect(pageHasSelector('.online')).toBe(true);
    expect(pageHasSelector('.offline')).toBe(false);
    expect(pageHasSelector('')).toBe(false);
  });
});
