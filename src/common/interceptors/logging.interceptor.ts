import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { TraceService } from '../logger/trace.service';
import { AppLogger } from '../logger/app-logger.service';
import {
  CallerType,
  RequestStatus,
  SLOW_REQUEST_THRESHOLDS,
} from '../logger/logger.types';

/**
 * HTTP 请求日志拦截器
 * 优化版本 - 每个请求只记录 1 条日志
 *
 * 职责：
 * 1. 在最外层调用 traceService.run() 生成 traceId
 * 2. 只在响应时记录日志（合并 request + response 信息）
 * 3. 计算 cost，判断慢请求
 * 4. 提取 userId 和 caller 类型
 * 5. 记录 handler（Controller.method）
 * 6. 慢日志分级与限流（符合《AI 日志修改宪法》）
 *
 * 优化点：
 * - 日志量减半（1 条 vs 2 条）
 * - 删除 userAgent（节省 60% 空间）
 * - 删除冗余 message 字段
 * - 确保 traceId/userId 完整
 * - 慢日志分级：>3000ms ERROR, 1000~3000ms WARN, 500~1000ms DEBUG
 * - WARN 级别限流：同一路径 60 秒内只记录 1 次
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  // 限流缓存：记录每个路径最后一次 WARN 日志的时间戳
  private readonly warnLogCache = new Map<string, number>();
  private readonly WARN_LOG_INTERVAL = 60000; // 60 秒
  private readonly ignorePathPrefixes: string[];

  constructor(
    private readonly traceService: TraceService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext('HTTP');

    this.ignorePathPrefixes = (
      process.env.LOG_IGNORE_PATHS || '/api/v1/metrics'
    )
      .split(',')
      .map((path) => path.trim())
      .filter(Boolean);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Skip noisy endpoints (configurable).
    const requestPath = request.url.split('?')[0];

    if (this.shouldIgnorePath(requestPath)) {
      return next.handle();
    }

    // traceService.run() 包裹整个 Observable 执行链
    return this.traceService.run(() => {
      const startTime = Date.now();

      // 提取 userId 和 caller
      this.extractUserContext(request);

      // 返回 Observable，只在响应时记录日志
      return next.handle().pipe(
        tap(() => {
          // 成功响应
          const costMs = Date.now() - startTime;
          this.logResponse(
            context,
            request,
            response,
            costMs,
            RequestStatus.SUCCESS,
          );
        }),
        catchError((error) => {
          // 失败响应
          const costMs = Date.now() - startTime;
          this.logResponse(
            context,
            request,
            response,
            costMs,
            RequestStatus.FAIL,
            error,
          );
          return throwError(() => error);
        }),
      );
    });
  }

  /**
   * 提取用户上下文（userId 和 caller）
   */
  private extractUserContext(request: Request): void {
    const user = (request as any).user;

    if (user?.id) {
      this.traceService.setUserId(String(user.id));

      // 根据用户角色判断 caller 类型
      if (user.role === 'AGENT') {
        this.traceService.setCaller(CallerType.AI);
      } else if (user.role === 'PLAYER' || user.role === 'ADMIN') {
        this.traceService.setCaller(CallerType.USER);
      } else {
        this.traceService.setCaller(CallerType.SYSTEM);
      }
    } else {
      this.traceService.setCaller(CallerType.SYSTEM);
    }
  }

  // Path filter from LOG_IGNORE_PATHS.
  private shouldIgnorePath(path: string): boolean {
    if (this.ignorePathPrefixes.length === 0) return false;
    return this.ignorePathPrefixes.some((prefix) => {
      if (prefix.endsWith('*')) {
        const base = prefix.slice(0, -1);
        return path.startsWith(base);
      }
      return path === prefix || path.startsWith(prefix);
    });
  }

  /**
   * 记录响应日志（合并 request + response 信息）
   * 优化：
   * 1. 字段名缩写化（timestamp→t, traceId→tid, userId→uid, method→m, path→p, statusCode→stc, cost→ms）
   * 2. 删除 userAgent 和冗余 message
   * 3. 动态采样：成功且快速的请求按采样率记录，失败和慢请求 100% 记录
   * 4. 慢日志分级：>3000ms ERROR, 1000~3000ms WARN（限流）, 500~1000ms DEBUG
   */
  private logResponse(
    context: ExecutionContext,
    request: Request,
    response: Response,
    costMs: number,
    status: RequestStatus,
    error?: any,
  ): void {
    const { method, url } = request;
    const statusCode = response.statusCode;

    // 动态采样：成功且快速的请求按采样率记录
    if (
      status === RequestStatus.SUCCESS &&
      costMs < SLOW_REQUEST_THRESHOLDS.DEBUG
    ) {
      // 检查是否完全禁用成功请求日志
      const logSuccessRequests = process.env.LOG_SUCCESS_REQUESTS !== 'false';
      if (!logSuccessRequests) {
        return; // 完全跳过成功请求的日志
      }

      // 按采样率记录
      const samplingRate = parseFloat(process.env.LOG_SAMPLING_RATE || '1.0');
      if (Math.random() > samplingRate) {
        return; // 跳过此次日志记录
      }
    }

    // 精简字段（Key 缩写化）
    const logContext = {
      m: method,
      p: url,
      st: status,
      stc: statusCode,
      ms: costMs, // 纯数字，不带 "ms" 后缀
      ...(error && {
        ec: error?.code,
        em: error?.message,
      }),
    };

    // 根据 costMs 和 status 决定日志级别（符合《AI 日志修改宪法》）
    // 添加 ctx 字段避免单例 context 污染
    const contextLogData = { ...logContext, ctx: 'HTTP' };

    if (costMs > SLOW_REQUEST_THRESHOLDS.ERROR) {
      // > 3000ms 使用 ERROR 级别（不限流）
      this.logger.error('Slow Request', undefined, contextLogData);
    } else if (costMs > SLOW_REQUEST_THRESHOLDS.WARN) {
      // 1000~3000ms 使用 WARN 级别（限流：同一路径 60 秒内只记录 1 次）
      if (this.shouldLogWarn(url)) {
        this.logger.warn('Slow Request', contextLogData);
      }
    } else if (costMs > SLOW_REQUEST_THRESHOLDS.DEBUG) {
      // 500~1000ms 使用 DEBUG 级别
      this.logger.debug('Slow Request', contextLogData);
    } else if (status === RequestStatus.FAIL) {
      // 失败使用 ERROR 级别
      this.logger.error('Request Failed', undefined, contextLogData);
    } else {
      // 正常使用 INFO 级别
      this.logger.log('Request', contextLogData);
    }
  }

  /**
   * 判断是否应该记录 WARN 级别的慢日志（限流）
   * 同一路径 60 秒内只记录 1 次
   */
  private shouldLogWarn(path: string): boolean {
    const now = Date.now();
    const lastLogTime = this.warnLogCache.get(path);

    if (!lastLogTime || now - lastLogTime > this.WARN_LOG_INTERVAL) {
      this.warnLogCache.set(path, now);
      return true;
    }

    return false;
  }

  /**
   * 获取 handler 名称（Controller.method）
   */
  private getHandlerName(context: ExecutionContext): string {
    const handler = context.getHandler();
    const controller = context.getClass();
    return `${controller.name}.${handler.name}`;
  }
}
