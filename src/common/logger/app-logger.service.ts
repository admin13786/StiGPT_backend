import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { TraceService } from './trace.service';
import { LoggerService } from './logger.service';
import {
  LogLevel,
  RequestLogContext,
  ResponseLogContext,
  ErrorLogContext,
  BusinessLogContext,
} from './logger.types';

function formatTimestamp(date: Date, offsetMinutes: number): string {
  const offsetDate = new Date(date.getTime() + offsetMinutes * 60000);
  const year = offsetDate.getUTCFullYear();
  const month = String(offsetDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(offsetDate.getUTCDate()).padStart(2, '0');
  const hours = String(offsetDate.getUTCHours()).padStart(2, '0');
  const minutes = String(offsetDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(offsetDate.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(offsetDate.getUTCMilliseconds()).padStart(3, '0');
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetMins = String(absOffset % 60).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${sign}${offsetHours}:${offsetMins}`;
}

/**
 * 统一日志服务
 * 符合 LOGGING_SPEC.md 规范
 *
 * 特性：
 * 1. 自动附加 traceId 和 userId
 * 2. JSON 格式输出
 * 3. 支持慢请求检测
 * 4. 统一字段命名（camelCase）
 * 5. 实现 NestJS LoggerService 接口，可用于框架日志
 * 6. 组合 LoggerService 实现文件写入
 *
 * 注意：使用默认作用域（SINGLETON），在依赖注入时每个模块会获得同一个实例
 * 但可以通过 setContext() 设置不同的上下文
 */
@Injectable()
export class AppLogger implements NestLoggerService {
  private context?: string;
  private static instance: AppLogger;

  private readonly timezoneOffsetMinutes: number;

  // 缓存日志级别配置（避免每次日志调用都读取环境变量）
  private readonly logLevelIndex: number;
  private static readonly LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

  constructor(
    private readonly traceService: TraceService,
    private readonly outputEngine: LoggerService,
  ) {
    const envLevel = process.env.LOG_LEVEL || 'INFO';
    this.logLevelIndex = AppLogger.LOG_LEVELS.indexOf(envLevel);
    const timezoneOffset = parseInt(
      process.env.LOG_TIMEZONE_OFFSET || '480',
      10,
    );
    this.timezoneOffsetMinutes = Number.isNaN(timezoneOffset)
      ? 480
      : timezoneOffset;
  }

  /**
   * 设置日志上下文（通常是类名）
   */
  setContext(context: string): void {
    this.context = context;
  }

  /**
   * 判断是否应该输出日志（基于日志级别，使用缓存配置）
   */
  private shouldLog(level: LogLevel): boolean {
    const messageLevelIndex = AppLogger.LOG_LEVELS.indexOf(level);
    return messageLevelIndex >= this.logLevelIndex;
  }

  /**
   * 格式化日志输出
   * @param level 日志级别
   * @param message 日志消息
   * @param meta 元数据（可选）
   * @param contextOverride 上下文覆盖（可选）- 解决单例 context 污染问题
   */
  private formatLog(
    level: LogLevel,
    message: string,
    meta?: Record<string, any>,
    contextOverride?: string,
  ): string {
    // 过滤敏感信息
    const filteredMeta = meta
      ? this.outputEngine.filterSensitiveData(meta)
      : undefined;

    const logEntry = {
      timestamp: formatTimestamp(new Date(), this.timezoneOffsetMinutes),
      level,
      traceId: this.traceService.getTraceId(),
      userId: this.traceService.getUserId(),
      context: contextOverride || this.context,
      message,
      ...filteredMeta,
    };

    // 移除 undefined 字段
    Object.keys(logEntry).forEach((key) => {
      if (logEntry[key] === undefined) {
        delete logEntry[key];
      }
    });

    return JSON.stringify(logEntry);
  }

  /**
   * 输出日志到控制台和文件
   * 通过 LoggerService 实现文件写入
   */
  private output(level: LogLevel, formattedLog: string): void {
    // 调用 LoggerService 写入文件（实时持久化）
    this.outputEngine.writeFormattedLog(level, formattedLog);

    // 开发环境同时输出到控制台（方便调试）
    if (process.env.NODE_ENV === 'development') {
      if (level === LogLevel.ERROR) {
        console.error(formattedLog);
      } else if (level === LogLevel.WARN) {
        console.warn(formattedLog);
      } else {
        console.log(formattedLog);
      }
    }
  }

  /**
   * 处理 NestJS 框架传递的参数
   * NestJS 可能传递：log(message, context) 或 log(message, meta)
   * 需要区分 context 字符串和 meta 对象
   */
  private parseLogArgs(
    message: any,
    contextOrMeta?: any,
  ): { message: string; meta?: Record<string, any> } {
    // 如果 message 不是字符串，转换为字符串
    const messageStr =
      typeof message === 'string' ? message : JSON.stringify(message);

    // 如果第二个参数是字符串，说明是 NestJS 传递的 context
    if (typeof contextOrMeta === 'string') {
      // 如果当前没有设置 context，使用传入的 context
      if (!this.context) {
        this.setContext(contextOrMeta);
      }
      return { message: messageStr };
    }

    // 如果第二个参数是对象，说明是 meta
    if (contextOrMeta && typeof contextOrMeta === 'object') {
      return { message: messageStr, meta: contextOrMeta };
    }

    return { message: messageStr };
  }

  /**
   * INFO 级别日志
   * 用于关键业务流程
   * 兼容 NestJS 框架调用：log(message, context)
   */
  log(message: any, contextOrMeta?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const { message: msg, meta } = this.parseLogArgs(message, contextOrMeta);
      this.output(LogLevel.INFO, this.formatLog(LogLevel.INFO, msg, meta));
    }
  }

  /**
   * ERROR 级别日志
   * 用于明确失败
   * 兼容 NestJS 框架调用：error(message, trace, context)
   *
   * 支持的调用方式：
   * 1. error(message) - 简单错误消息
   * 2. error(message, context) - 带 context 字符串
   * 3. error(message, trace, context) - 带 stack trace 和 context
   * 4. error(message, meta) - 带 meta 对象
   * 5. error(message, trace, meta) - 带 stack trace 和 meta 对象 ★重要★
   */
  error(message: any, traceOrContext?: any, contextOrMeta?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      let trace: string | undefined;
      let meta: Record<string, any> | undefined;

      if (
        typeof traceOrContext === 'string' &&
        typeof contextOrMeta === 'string'
      ) {
        // error(message, trace, context) - NestJS 标准调用
        trace = traceOrContext;
        if (!this.context) {
          this.setContext(contextOrMeta);
        }
      } else if (
        typeof traceOrContext === 'string' &&
        typeof contextOrMeta === 'object' &&
        contextOrMeta !== null
      ) {
        // error(message, trace, meta) - 带 stack trace 和 meta 对象 ★修复★
        trace = traceOrContext;
        meta = contextOrMeta;
      } else if (typeof traceOrContext === 'string' && !contextOrMeta) {
        // error(message, context) - 第二个参数是 context
        if (!this.context) {
          this.setContext(traceOrContext);
        }
      } else if (
        typeof traceOrContext === 'object' &&
        traceOrContext !== null
      ) {
        // error(message, meta) - 第二个参数是 meta 对象
        meta = traceOrContext;
      }

      const messageStr =
        typeof message === 'string' ? message : JSON.stringify(message);
      const errorMeta = {
        ...meta,
        ...(trace && { exception: trace }),
      };
      this.output(
        LogLevel.ERROR,
        this.formatLog(LogLevel.ERROR, messageStr, errorMeta),
      );
    }
  }

  /**
   * WARN 级别日志
   * 用于慢请求 / 风险行为
   * 兼容 NestJS 框架调用：warn(message, context)
   */
  warn(message: any, contextOrMeta?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const { message: msg, meta } = this.parseLogArgs(message, contextOrMeta);
      this.output(LogLevel.WARN, this.formatLog(LogLevel.WARN, msg, meta));
    }
  }

  /**
   * DEBUG 级别日志
   * 通过 LOG_LEVEL 环境变量控制
   * 兼容 NestJS 框架调用：debug(message, context)
   */
  debug(message: any, contextOrMeta?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const { message: msg, meta } = this.parseLogArgs(message, contextOrMeta);
      this.output(LogLevel.DEBUG, this.formatLog(LogLevel.DEBUG, msg, meta));
    }
  }

  /**
   * VERBOSE 级别日志（兼容 NestJS LoggerService 接口）
   */
  verbose(message: any, contextOrMeta?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const { message: msg, meta } = this.parseLogArgs(message, contextOrMeta);
      this.output(LogLevel.DEBUG, this.formatLog(LogLevel.DEBUG, msg, meta));
    }
  }

  /**
   * 记录 HTTP 请求日志
   * 符合 LOGGING_SPEC.md 第 3 节规范
   */
  logRequest(context: RequestLogContext): void {
    this.log('HTTP Request', context);
  }

  /**
   * 记录 HTTP 响应日志
   * 符合 LOGGING_SPEC.md 第 3 节规范
   *
   * 注意：慢请求判断由 HTTP 拦截器负责，Logger 只负责输出
   */
  logResponse(context: ResponseLogContext): void {
    const { status } = context;

    if (status === 'FAIL') {
      this.error('HTTP Response', undefined, context);
    } else {
      this.log('HTTP Response', context);
    }
  }

  /**
   * 记录错误日志
   * 符合 LOGGING_SPEC.md 第 6 节规范
   *
   * traceId 和 userId 统一从 TraceService 获取，避免链路污染
   */
  logError(context: ErrorLogContext): void {
    this.error(context.errorMessage, context.stack, {
      status: context.status,
      errorCode: context.errorCode,
      // 不从 context 注入 traceId/userId，统一从 TraceService 获取
    });
  }

  /**
   * 记录业务日志
   * 用于关键业务节点
   */
  logBusiness(context: BusinessLogContext): void {
    this.log(`Business: ${context.action}`, context);
  }

  /**
   * 创建子 Logger（带上下文）
   */
  static create(
    traceService: TraceService,
    outputEngine: LoggerService,
    context: string,
  ): AppLogger {
    const logger = new AppLogger(traceService, outputEngine);
    logger.setContext(context);
    return logger;
  }

  /**
   * 创建全局单例（用于 NestJS 框架日志）
   * 注意：框架日志不会有 traceId/userId
   */
  static createGlobal(
    traceService: TraceService,
    outputEngine: LoggerService,
  ): AppLogger {
    if (!AppLogger.instance) {
      AppLogger.instance = new AppLogger(traceService, outputEngine);
      AppLogger.instance.setContext('NestApplication');
    }
    return AppLogger.instance;
  }
}
