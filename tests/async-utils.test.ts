import { describe, expect, it } from 'vitest';
import { delay, mapWithConcurrency, withTimeout } from '../src/background/async-utils';

describe('mapWithConcurrency', () => {
  it('限制并发数并保持结果顺序', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await delay(5);
      running -= 1;
      return value * 2;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('空数组直接返回', async () => {
    expect(await mapWithConcurrency([], 3, async (value) => value)).toEqual([]);
  });
});

describe('withTimeout', () => {
  it('任务按时完成时返回结果', async () => {
    const result = await withTimeout(async () => 'ok', 100);
    expect(result).toBe('ok');
  });

  it('超时后中断任务并抛出异常', async () => {
    await expect(
      withTimeout(
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
          }),
        20,
      ),
    ).rejects.toThrow('操作超时');
  });

  it('外部取消会传导到内部信号', async () => {
    const controller = new AbortController();
    const task = withTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      1_000,
      controller.signal,
    );
    controller.abort(new Error('用户取消'));
    await expect(task).rejects.toThrow('用户取消');
  });
});

describe('delay', () => {
  it('可以按信号取消', async () => {
    const controller = new AbortController();
    const task = delay(1_000, controller.signal);
    controller.abort(new Error('停止'));
    await expect(task).rejects.toThrow('停止');
  });

  it('已取消的信号立即拒绝', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(delay(10, controller.signal)).rejects.toThrow();
  });
});
