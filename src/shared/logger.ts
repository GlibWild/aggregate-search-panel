/**
 * 统一日志封装。所有模块使用带作用域的 logger，便于在扩展的
 * Service Worker / 面板控制台中按来源过滤。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, error?: unknown, data?: unknown): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let threshold: LogLevel = 'debug';

/** 调整全局日志级别（后续可由设置页接管）。 */
export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[threshold];
}

function write(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  if (!shouldLog(level)) {
    return;
  }
  const prefix = `[聚合面板:${scope}]`;
  if (detail === undefined) {
    console[level === 'debug' ? 'log' : level](prefix, message);
    return;
  }
  console[level === 'debug' ? 'log' : level](prefix, message, detail);
}

/** 创建带作用域的 logger。 */
export function createLogger(scope: string): Logger {
  return {
    debug(message, data) {
      write('debug', scope, message, data);
    },
    info(message, data) {
      write('info', scope, message, data);
    },
    warn(message, data) {
      write('warn', scope, message, data);
    },
    error(message, error, data) {
      write('error', scope, message, { error, data });
    },
  };
}
