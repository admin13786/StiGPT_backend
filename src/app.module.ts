import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import * as net from 'node:net';
import { join, isAbsolute } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { GameModule } from './game/game.module';
import { TicketModule } from './ticket/ticket.module';
import { SessionModule } from './session/session.module';
import { MessageModule } from './message/message.module';
import { DifyModule } from './dify/dify.module';
import { UrgencyRuleModule } from './urgency-rule/urgency-rule.module';
import { WebsocketModule } from './websocket/websocket.module';
import { SatisfactionModule } from './satisfaction/satisfaction.module';
import { UploadModule } from './upload/upload.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TicketMessageModule } from './ticket-message/ticket-message.module';
import { UserModule } from './user/user.module';
import { IssueTypeModule } from './issue-type/issue-type.module';
import { QuickReplyModule } from './quick-reply/quick-reply.module';
import { LoggerModule } from './common/logger/logger.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RedisModule } from './redis/redis.module';
import { EncryptionModule } from './common/encryption/encryption.module';
import { CacheModule } from './common/cache/cache.module';
import { validate } from './common/config/env.validation';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import {
  getDifyThrottleKey,
  isDifyHttpRequest,
} from './common/guards/throttle-keys';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { VectorModule } from './vector/vector.module';
import { DocumentModule } from './document/document.module';
import { RagModule } from './rag/rag.module';
import { AsrModule } from './common/services/asr.module';
import { TtsModule } from './common/services/tts.module';
import { AvatarModule } from './avatar/avatar.module';
import { LinlyTalkerModule } from './linly-talker/linly-talker.module';
import { AiWriteModule } from './ai-write/ai-write.module';
import { AiCheckModule } from './ai-check/ai-check.module';
import { AiReviewModule } from './ai-review/ai-review.module';
import { PaperModule } from './paper/paper.module';
import { StigptChatModule } from './stigpt-chat/stigpt-chat.module';
import { GraphModule } from './graph/graph.module';
// import { MetricsModule } from './metrics/metrics.module'; // disabled for fast release

async function isTcpServiceReachable(
  host: string,
  port: number,
  timeoutMs = 800,
): Promise<boolean> {
  if (!host || !Number.isFinite(port) || port <= 0) {
    return false;
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

@Module({
  imports: [
    // MetricsModule, // disabled for fast release
    ScheduleModule.forRoot(),
    LoggerModule,
    RedisModule,
    EncryptionModule,
    CacheModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
        const redisPort = configService.get<number>('REDIS_PORT', 6379);
        let storage: ThrottlerStorageRedisService | undefined;

        if (redisUrl) {
          try {
            const parsed = new URL(redisUrl);
            const port = Number(parsed.port || 6379);
            const isReachable = await isTcpServiceReachable(parsed.hostname, port);

            if (isReachable) {
              storage = new ThrottlerStorageRedisService(redisUrl);
            } else {
              console.warn(
                `[Throttler] Redis ${parsed.hostname}:${port} not reachable, using in-memory storage`,
              );
            }
          } catch {
            console.warn(
              `[Throttler] Invalid REDIS_URL "${redisUrl}", using in-memory storage`,
            );
          }
        } else {
          const isReachable = await isTcpServiceReachable(redisHost, redisPort);

          if (isReachable) {
            storage = new ThrottlerStorageRedisService({
              host: redisHost,
              port: redisPort,
            });
          } else {
            console.warn(
              `[Throttler] Redis ${redisHost}:${redisPort} not reachable, using in-memory storage`,
            );
          }
        }

        // 从环境变量读取限流配置
        const globalTtl = configService.get<number>('THROTTLE_GLOBAL_TTL', 60000);
        const globalLimit = configService.get<number>('THROTTLE_GLOBAL_LIMIT', 200);
        const difyTtl = configService.get<number>('THROTTLE_DIFY_TTL', 60000);
        const difyLimit = configService.get<number>('THROTTLE_DIFY_LIMIT', 100);

        return {
          throttlers: [
            {
              ttl: globalTtl,
              limit: globalLimit,
            },
            {
              name: 'dify-api',
              ttl: difyTtl,
              limit: difyLimit,
              getTracker: getDifyThrottleKey,
              skipIf: (context) => {
                if (context.getType() !== 'http') {
                  return true;
                }
                const req = context.switchToHttp().getRequest();
                return !isDifyHttpRequest(req);
              },
            },
          ],
          ...(storage ? { storage } : {}),
        };
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate,
    }),
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const configuredDir =
          configService.get<string>('UPLOAD_DIR') || 'uploads';
        const rootPath = isAbsolute(configuredDir)
          ? configuredDir
          : join(process.cwd(), configuredDir);
        return [
          {
            rootPath,
            serveRoot: '/uploads',
          },
        ];
      },
    }),
    AuthModule,
    GameModule,
    IssueTypeModule,
    TicketModule,
    SessionModule,
    MessageModule,
    DifyModule,
    UrgencyRuleModule,
    WebsocketModule,
    SatisfactionModule,
    UploadModule,
    DashboardModule,
    TicketMessageModule,
    UserModule,
    QuickReplyModule,
    KnowledgeModule,
    VectorModule,
    DocumentModule,
    RagModule,
    AsrModule,
    TtsModule,
    AvatarModule,
    LinlyTalkerModule,
    AiWriteModule,
    AiCheckModule,
    AiReviewModule,
    PaperModule,
    StigptChatModule,
    GraphModule,
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    LoggingInterceptor,
    HttpExceptionFilter,
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule { }
