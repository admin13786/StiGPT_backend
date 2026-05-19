import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { throwGameNotFound, BusinessException, ErrorCodes } from '../common/exceptions';
import { CreateGameDto, UpdateGameDto } from './dto/create-game.dto';
import { CreateServerDto, UpdateServerDto } from './dto/create-server.dto';
import { EncryptionService } from '../common/encryption/encryption.service';
import { CacheService } from '../common/cache/cache.service';

@Injectable()
export class GameService {
  private readonly cachePrefix = 'cache:game:';
  private cacheTtlSeconds: number;

  constructor(
    private prisma: PrismaService,
    private encryptionService: EncryptionService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {
    this.cacheTtlSeconds = this.getConfigCacheTtl();
  }

  private getConfigCacheTtl(): number {
    const ttl = Number(
      this.configService.get<number>('CACHE_CONFIG_TTL_SECONDS') ?? 900,
    );
    return Number.isFinite(ttl) && ttl > 0 ? ttl : 900;
  }

  private async clearGameCache(gameId?: string) {
    const keys = [`${this.cachePrefix}all`, `${this.cachePrefix}enabled`];
    if (gameId) {
      keys.push(
        `${this.cachePrefix}id:${gameId}`,
        `${this.cachePrefix}servers:${gameId}`,
      );
    }
    await this.cacheService.delMany(keys);
  }

  // 游戏管理
  async findAll() {
    const cacheKey = `${this.cachePrefix}all`;
    return this.cacheService.getOrSet(cacheKey, this.cacheTtlSeconds, () =>
      this.prisma.game.findMany({
        where: { deletedAt: null },
        include: {
          servers: {
            where: { deletedAt: null },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async findOne(id: string) {
    const cacheKey = `${this.cachePrefix}id:${id}`;
    const game = await this.cacheService.getOrSet(
      cacheKey,
      this.cacheTtlSeconds,
      async () => {
        const result = await this.prisma.game.findUnique({
          where: { id, deletedAt: null },
          include: {
            servers: {
              where: { deletedAt: null },
            },
          },
        });
        return result ?? null;
      },
    );

    if (!game) {
      throwGameNotFound();
    }

    return game;
  }

  async findEnabled() {
    const cacheKey = `${this.cachePrefix}enabled`;
    return this.cacheService.getOrSet(cacheKey, this.cacheTtlSeconds, () =>
      this.prisma.game.findMany({
        where: {
          enabled: true,
          deletedAt: null,
        },
        include: {
          servers: {
            where: {
              enabled: true,
              deletedAt: null,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async create(createGameDto: CreateGameDto) {
    // 加密 API Key
    const encryptedApiKey = this.encryptionService.encrypt(
      createGameDto.difyApiKey,
    );

    const game = await this.prisma.game.create({
      data: {
        ...createGameDto,
        difyApiKey: encryptedApiKey,
      },
      include: {
        servers: true,
      },
    });
    await this.clearGameCache(game.id);
    return game;
  }

  async update(id: string, updateGameDto: UpdateGameDto) {
    await this.findOne(id);

    // 如果更新了 API Key，需要加密
    const updateData: any = { ...updateGameDto };
    if (updateGameDto.difyApiKey) {
      updateData.difyApiKey = this.encryptionService.encrypt(
        updateGameDto.difyApiKey,
      );
    }

    const updated = await this.prisma.game.update({
      where: { id },
      data: updateData,
      include: {
        servers: true,
      },
    });
    await this.clearGameCache(id);
    return updated;
  }

  async remove(id: string) {
    await this.findOne(id);
    const removed = await this.prisma.game.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.clearGameCache(id);
    return removed;
  }

  // 区服管理
  async findServersByGame(gameId: string) {
    await this.findOne(gameId);
    const cacheKey = `${this.cachePrefix}servers:${gameId}`;
    return this.cacheService.getOrSet(cacheKey, this.cacheTtlSeconds, () =>
      this.prisma.server.findMany({
        where: {
          gameId,
          deletedAt: null,
        },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async createServer(createServerDto: CreateServerDto) {
    await this.findOne(createServerDto.gameId);
    const server = await this.prisma.server.create({
      data: createServerDto,
    });
    await this.clearGameCache(createServerDto.gameId);
    return server;
  }

  async updateServer(id: string, updateServerDto: UpdateServerDto) {
    const server = await this.prisma.server.findUnique({
      where: { id, deletedAt: null },
    });

    if (!server) {
      throw new BusinessException(ErrorCodes.SERVER_NOT_FOUND);
    }

    const updated = await this.prisma.server.update({
      where: { id },
      data: updateServerDto,
    });
    await this.clearGameCache(server.gameId);
    return updated;
  }

  async removeServer(id: string) {
    const server = await this.prisma.server.findUnique({
      where: { id, deletedAt: null },
    });

    if (!server) {
      throw new BusinessException(ErrorCodes.SERVER_NOT_FOUND);
    }

    const removed = await this.prisma.server.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.clearGameCache(server.gameId);
    return removed;
  }
}
