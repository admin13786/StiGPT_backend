import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { throwTicketNotFound } from '../common/exceptions';

@Injectable()
export class TicketMessageService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取工单的所有消息（包括所有关联会话的消息）
   * 用于玩家端查看完整的对话历史
   */
  async getTicketMessages(ticketId: string) {
    // 验证工单存在
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throwTicketNotFound(ticketId);
    }

    // 获取工单的所有会话
    const sessions = await this.prisma.session.findMany({
      where: { ticketId },
      select: { id: true },
    });

    const sessionIds = sessions.map((s) => s.id);

    // 获取所有会话的消息，按时间排序
    const messages = await this.prisma.message.findMany({
      where: {
        sessionId: { in: sessionIds },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        agent: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
      },
    });

    return messages;
  }
}
