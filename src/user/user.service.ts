import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, ErrorCodes, throwUserNotFound } from '../common/exceptions';
import { CreateUserDto, QueryUsersDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeUser(user: any) {
    if (!user) return null;
    const { password, ...rest } = user;
    return rest;
  }

  async create(createUserDto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { username: createUserDto.username },
    });

    if (existing && !existing.deletedAt) {
      throw new BusinessException(ErrorCodes.USER_ALREADY_EXISTS);
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        username: createUserDto.username,
        password: hashedPassword,
        role: createUserDto.role,
        realName: createUserDto.realName,
        email: createUserDto.email,
        phone: createUserDto.phone,
        avatar: createUserDto.avatar,
      },
    });

    return this.sanitizeUser(user);
  }

  async findAll(query: QueryUsersDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const skip = (page - 1) * pageSize;

    const where: any = {
      deletedAt: null,
    };

    if (query.role) {
      where.role = query.role;
    }

    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { realName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((item) => this.sanitizeUser(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user || user.deletedAt) {
      throwUserNotFound();
    }

    return this.sanitizeUser(user);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user || user.deletedAt) {
      throwUserNotFound();
    }

    const data: any = { ...updateUserDto };

    if (updateUserDto.password) {
      data.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
    });

    return this.sanitizeUser(updated);
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user || user.deletedAt) {
      throwUserNotFound();
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }

  async findOnlineAgents() {
    const agents = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        role: { in: ['AGENT', 'ADMIN'] },
        isOnline: true,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        avatar: true,
        email: true,
        phone: true,
        isOnline: true,
        lastLoginAt: true,
      },
      orderBy: { username: 'asc' },
    });

    return agents.map((agent) => this.sanitizeUser(agent));
  }

  // 检查是否有在线客服（公共接口，不需要认证）
  async hasOnlineAgents(): Promise<{ hasAgents: boolean; count: number }> {
    const count = await this.prisma.user.count({
      where: {
        deletedAt: null,
        role: { in: ['AGENT', 'ADMIN'] },
        isOnline: true,
      },
    });

    return {
      hasAgents: count > 0,
      count,
    };
  }
}
