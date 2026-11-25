/**
 * 搜索流程中的业务错误。
 */

/** 需要用户先扫码登录。 */
export class LoginRequiredError extends Error {
  constructor(message = '需要登录后才能搜索') {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

/** 当前策略没有提取到任何结果。 */
export class EmptyResultError extends Error {
  constructor(message = '未提取到搜索结果') {
    super(message);
    this.name = 'EmptyResultError';
  }
}

/** 任务被取消。 */
export class CancelledError extends Error {
  constructor(message = '任务已取消') {
    super(message);
    this.name = 'CancelledError';
  }
}

/** 将未知异常转换为可读文案。 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
