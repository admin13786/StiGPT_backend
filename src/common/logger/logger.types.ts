/**
 * 日志级别
 * 符合 LOGGING_SPEC.md 规范
 */
export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
}

/**
 * 调用者类型
 */
export enum CallerType {
  USER = 'USER',
  AI = 'AI',
  SYSTEM = 'SYSTEM',
}

/**
 * 请求状态
 */
export enum RequestStatus {
  SUCCESS = 'SUCCESS',
  FAIL = 'FAIL',
}

/**
 * 请求日志上下文
 * 符合 LOGGING_SPEC.md 第 3 节规范
 */
export interface RequestLogContext {
  traceId: string;
  userId?: string;
  caller: CallerType;
  ip: string;
  method: string;
  path: string;
  handler?: string;
  userAgent?: string;
}

/**
 * 响应日志上下文
 * 符合 LOGGING_SPEC.md 第 3 节规范
 */
export interface ResponseLogContext extends RequestLogContext {
  costMs: number;
  status: RequestStatus;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * 错误日志上下文
 * 符合 LOGGING_SPEC.md 第 6 节规范
 *
 * 注意：traceId 和 userId 由 TraceService 自动注入，不需要手动传递
 */
export interface ErrorLogContext {
  status: RequestStatus.FAIL;
  errorCode: string;
  errorMessage: string;
  exception?: string;
  stack?: string;
}

/**
 * 业务日志上下文
 */
export interface BusinessLogContext {
  traceId?: string;
  userId?: string;
  action: string;
  [key: string]: any;
}

/**
 * 慢请求阈值（毫秒）
 * 符合《AI 日志修改宪法》第五节规范
 */
export const SLOW_REQUEST_THRESHOLDS = {
  DEBUG: 500, // 500~1000ms 记录 DEBUG
  WARN: 1000, // 1000~3000ms 记录 WARN（限流）
  ERROR: 3000, // > 3000ms 记录 ERROR（不限流）
} as const;
