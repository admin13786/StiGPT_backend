import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { getDefaultThrottleKey } from './throttle-keys';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    return super.shouldSkip(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return getDefaultThrottleKey(req);
  }

  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const prefix = `${context.getClass().name}-${context.getHandler().name}-${name}`;
    const hash = createHash('sha256')
      .update(`${prefix}-${suffix}`)
      .digest('hex');
    return `rl:http:${hash}`;
  }
}
