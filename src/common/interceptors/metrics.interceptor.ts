import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  httpRequestsCounter,
  httpRequestDurationHistogram,
} from '../../metrics/queue.metrics';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // 绕过 /api/v1/metrics 端点，不记录其自身的指标
    if (request.url === '/api/v1/metrics') {
      return next.handle();
    }

    const method = request.method;
    // 优先使用 NestJS route metadata，回退到 request.route.path
    const route = this.getRouteFromContext(context, request);

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = (Date.now() - startTime) / 1000;
          const statusCode = response.statusCode.toString();

          httpRequestsCounter.inc({
            method,
            route,
            status_code: statusCode,
          });

          httpRequestDurationHistogram.observe(
            {
              method,
              route,
            },
            duration,
          );
        },
        error: (error) => {
          const duration = (Date.now() - startTime) / 1000;
          const statusCode = error.status?.toString() || '500';

          httpRequestsCounter.inc({
            method,
            route,
            status_code: statusCode,
          });

          httpRequestDurationHistogram.observe(
            {
              method,
              route,
            },
            duration,
          );
        },
      }),
    );
  }

  private getRouteFromContext(context: ExecutionContext, request: any): string {
    // 1. 优先使用 request.route.path
    if (request.route?.path) {
      return request.route.path;
    }

    // 2. 使用当前 handler 的方法名
    const handler = context.getHandler();
    if (handler?.name) {
      return handler.name;
    }

    // 3. 固定字符串 "unknown"
    return 'unknown';
  }
}
