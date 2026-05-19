import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { AppLogger } from '../common/logger/app-logger.service';

// 静态 Logger 用于静态方法（在实例创建前使用）
const staticLogger = new Logger('PrismaService');

// 数据库服务
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger: AppLogger;

  constructor(
    private configService: ConfigService,
    logger: AppLogger,
  ) {
    // 构建完整的数据库连接字符串（包含连接池参数）
    const databaseUrl = PrismaService.buildDatabaseUrl(configService);

    super({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      // 日志配置（生产环境仅记录错误）
      log: PrismaService.getLogLevel(configService),
      // 错误格式化
      errorFormat: 'pretty',
    });

    // Initialize logger after super()
    this.logger = logger;
    this.logger.setContext(PrismaService.name);
  }

  /**
   * 构建包含连接池参数的数据库连接字符串
   */
  private static buildDatabaseUrl(configService: ConfigService): string {
    const baseUrl =
      configService.get<string>('DATABASE_URL_BASE') ||
      configService.get<string>('DATABASE_URL') ||
      process.env.DATABASE_URL;

    if (!baseUrl) {
      throw new Error('DATABASE_URL 环境变量未设置');
    }

    // 如果已经包含连接池参数，直接返回
    if (
      baseUrl.includes('connection_limit') ||
      baseUrl.includes('pool_timeout')
    ) {
      staticLogger.warn('DATABASE_URL 已包含连接池参数，将使用现有配置');
      return baseUrl;
    }

    // 从环境变量读取连接池参数（带默认值）
    const connectionLimit =
      configService.get<number>('DB_CONNECTION_LIMIT') || 50;
    const poolTimeout = configService.get<number>('DB_POOL_TIMEOUT') || 20;
    const connectTimeout =
      configService.get<number>('DB_CONNECT_TIMEOUT') || 10;
    const queryTimeout = configService.get<number>('DB_QUERY_TIMEOUT') || 30;
    const statementTimeout =
      configService.get<number>('DB_STATEMENT_TIMEOUT') || 30000;
    const idleTimeout = configService.get<number>('DB_IDLE_TIMEOUT') || 600;

    // 构建连接字符串
    const separator = baseUrl.includes('?') ? '&' : '?';
    const poolParams = [
      `connection_limit=${connectionLimit}`,
      `pool_timeout=${poolTimeout}`,
      `connect_timeout=${connectTimeout}`,
      `query_timeout=${queryTimeout}`,
      `statement_timeout=${statementTimeout}`,
      `idle_in_transaction_session_timeout=${idleTimeout * 1000}`, // PostgreSQL 使用毫秒
    ].join('&');

    const fullUrl = `${baseUrl}${separator}${poolParams}`;

    staticLogger.log(
      `数据库连接池配置: 最大连接数=${connectionLimit}, 连接超时=${connectTimeout}s, 查询超时=${queryTimeout}s`,
    );

    return fullUrl;
  }

  /**
   * 获取日志级别
   */
  private static getLogLevel(configService: ConfigService): Prisma.LogLevel[] {
    const logLevel = configService.get<string>('DB_POOL_LOG_LEVEL') || 'warn';
    const nodeEnv = configService.get<string>('NODE_ENV') || 'development';

    if (nodeEnv === 'production') {
      return ['error', 'warn'];
    }

    switch (logLevel) {
      case 'query':
        return ['query', 'info', 'warn', 'error'];
      case 'info':
        return ['info', 'warn', 'error'];
      case 'warn':
        return ['warn', 'error'];
      case 'error':
        return ['error'];
      default:
        return ['warn', 'error'];
    }
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('数据库连接成功');
    } catch (error) {
      this.logger.error('数据库连接失败', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.debug('数据库连接已关闭');
    } catch (error) {
      this.logger.error('关闭数据库连接时出错', error);
    }
  }
}
