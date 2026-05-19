import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { DifyService } from './dify.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GameService } from '../game/game.service';
import { getDifyThrottleKey } from '../common/guards/throttle-keys';
import { Logger } from '@nestjs/common';

@ApiTags('dify')
@ApiBearerAuth('JWT-auth')
@Controller('dify')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'AGENT')
export class DifyController {
  private readonly logger = new Logger(DifyController.name);

  constructor(
    private readonly difyService: DifyService,
    private readonly gameService: GameService,
    private readonly configService: ConfigService,
  ) {}

  @Post('chat-messages')
  @Throttle({
    'dify-api': {
      limit: 100,
      ttl: 60000,
      getTracker: getDifyThrottleKey,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '代理 Dify Chat API 请求（AI优化功能）' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要发送给 Dify 的查询内容' },
        gameId: {
          type: 'string',
          description: '游戏ID（可选，用于获取该游戏的 Dify 配置）',
        },
        inputs: { type: 'object', description: '输入参数（可选）' },
        response_mode: {
          type: 'string',
          enum: ['blocking', 'streaming'],
          description: '响应模式',
        },
        user: { type: 'string', description: '用户标识（可选）' },
        conversation_id: {
          type: 'string',
          description: '会话ID（可选，用于会话持久化）',
        },
      },
      required: ['query'],
    },
  })
  async proxyChatMessage(
    @Body()
    body: {
      query: string;
      gameId?: string;
      inputs?: Record<string, any>;
      response_mode?: 'blocking' | 'streaming';
      user?: string;
      conversation_id?: string;
    },
    @CurrentUser() user: any,
  ) {
    if (!body.query) {
      throw new BadRequestException('query 参数不能为空');
    }

    let apiKey: string;
    let baseUrl: string;

    // 如果提供了 gameId，从数据库获取该游戏的 Dify 配置
    if (body.gameId) {
      try {
        const game = await this.gameService.findOne(body.gameId);
        if (!game.difyApiKey || !game.difyBaseUrl) {
          throw new NotFoundException('该游戏未配置 Dify API');
        }
        // 注意：不在这里解密，DifyService 内部会自动解密
        apiKey = game.difyApiKey;
        baseUrl = game.difyBaseUrl;
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw error;
        }
        throw new NotFoundException('游戏不存在或配置错误');
      }
    } else {
      // 如果没有提供 gameId，使用环境变量中的 AI 话术优化 API 配置
      apiKey = this.configService.get<string>('DIFY_API_KEY') || '';
      baseUrl = this.configService.get<string>('DIFY_BASE_URL') || '';

      if (!apiKey || !baseUrl) {
        throw new BadRequestException(
          '未提供 gameId 且环境变量中未配置 Dify API，请提供 gameId 参数',
        );
      }
    }

    const userId = body.user || user?.id || user?.username || 'agent';

    // 调用 DifyService 发送消息
    const result = await this.difyService.sendChatMessage(
      body.query,
      apiKey,
      baseUrl,
      body.conversation_id,
      userId,
    );

    try {
      this.logger.debug(
        `proxyChatMessage result: ${JSON.stringify({
          textLength: result?.text?.length ?? 0,
          status: result?.status,
          options: result?.suggestedOptions?.length ?? 0,
          conversationId: result?.conversationId,
        })}`,
      );
    } catch {
      /* ignore stringify errors */
    }

    return result;
  }
}
