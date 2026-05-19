import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TicketService } from '../../ticket/ticket.service';

/**
 * 工单 Token 验证 Guard
 * 用于验证玩家端请求的工单 token 是否有效
 */
@Injectable()
export class TicketTokenGuard implements CanActivate {
  constructor(
    private ticketService: TicketService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 从多个位置获取 token（兼容不同传递方式）
    const ticketToken =
      request.headers['x-ticket-token'] ||
      request.query.token ||
      request.body?.token ||
      request.params?.token;

    // ✅ 如果没有 token，允许通过（可能由其他 Guard 处理，如 JWT）
    if (!ticketToken) {
      return true;
    }

    // 验证 token 是否有效
    try {
      const ticket = await this.ticketService.findByToken(ticketToken);
      // 将工单信息附加到请求对象，供后续使用
      request.ticket = ticket;
      return true;
    } catch (error) {
      throw new UnauthorizedException('无效的工单 token');
    }
  }
}
