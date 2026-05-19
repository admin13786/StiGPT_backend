import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getClientIpFromRequest } from './throttle-keys';

@Injectable()
export class MetricsAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const expectedKey = this.configService.get<string>('METRICS_KEY');
    const providedKey = request.headers?.['x-metrics-key'];

    if (expectedKey && providedKey === expectedKey) {
      return true;
    }

    const ip = getClientIpFromRequest(request);
    return this.isPrivateIp(ip);
  }

  private isPrivateIp(ip: string): boolean {
    const normalized = ip.toLowerCase().trim();
    if (!normalized || normalized === 'unknown') {
      return false;
    }

    if (normalized === '::1' || normalized === '127.0.0.1') {
      return true;
    }

    let ipv4 = normalized;
    if (ipv4.startsWith('::ffff:')) {
      ipv4 = ipv4.slice(7);
    }

    const parts = ipv4.split('.');
    if (parts.length !== 4 || parts.some((p) => p === '' || isNaN(+p))) {
      return false;
    }

    const [a, b] = parts.map((p) => parseInt(p, 10));
    if (a === 10 || a === 127) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }

    return false;
  }
}
