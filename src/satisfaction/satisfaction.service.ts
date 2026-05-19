import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, ErrorCodes, throwSessionNotFound } from '../common/exceptions';
import { CreateRatingDto } from './dto/create-rating.dto';
import { TicketService } from '../ticket/ticket.service';

@Injectable()
export class SatisfactionService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => TicketService))
    private ticketService: TicketService,
  ) {}

  // 创建满意度评价
  async create(createRatingDto: CreateRatingDto) {
    // 检查会话是否存在且已关闭
    const session = await this.prisma.session.findUnique({
      where: { id: createRatingDto.sessionId },
      include: { ticket: true, agent: true },
    });

    if (!session) {
      throwSessionNotFound(createRatingDto.sessionId);
    }

    if (session.status !== 'CLOSED') {
      throw new BusinessException(ErrorCodes.SESSION_INVALID_STATUS, '会话尚未结束，无法评价');
    }

    // 检查是否已评价
    const existingRating = await this.prisma.satisfactionRating.findUnique({
      where: { sessionId: createRatingDto.sessionId },
    });

    if (existingRating) {
      throw new BusinessException(ErrorCodes.SYSTEM_VALIDATION_ERROR, '该会话已评价');
    }

    const rating = await this.prisma.satisfactionRating.create({
      data: {
        sessionId: createRatingDto.sessionId,
        ticketId: session.ticketId,
        agentId: session.agentId || null,
        rating: createRatingDto.rating,
        tags: createRatingDto.tags,
        comment: createRatingDto.comment || null,
      },
    });

    // 检查并更新关联工单的状态
    if (session.ticketId) {
      await this.ticketService.checkAndUpdateTicketStatus(session.ticketId);
    }

    return rating;
  }

  // 获取会话的评价
  async findBySession(sessionId: string) {
    return this.prisma.satisfactionRating.findUnique({
      where: { sessionId },
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
  }

  // 获取客服的评价统计
  async getAgentStats(agentId: string, startDate?: Date, endDate?: Date) {
    const where: any = { agentId };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const ratings = await this.prisma.satisfactionRating.findMany({
      where,
    });

    if (ratings.length === 0) {
      return {
        total: 0,
        average: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
    }

    const total = ratings.length;
    const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
    const average = sum / total;

    const distribution = ratings.reduce(
      (acc, r) => {
        acc[r.rating] = (acc[r.rating] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>,
    );

    return {
      total,
      average: Math.round(average * 100) / 100,
      distribution: {
        1: distribution[1] || 0,
        2: distribution[2] || 0,
        3: distribution[3] || 0,
        4: distribution[4] || 0,
        5: distribution[5] || 0,
      },
    };
  }
}
