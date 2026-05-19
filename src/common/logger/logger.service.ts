import {
  Injectable,
  LoggerService as NestLoggerService,
  OnModuleDestroy,
  Inject,
  Optional,
} from '@nestjs/common';
import { createWriteStream, existsSync, mkdirSync, promises as fs } from 'fs';
import { join } from 'path';
import { gzip } from 'zlib';
import { promisify } from 'util';
import { RedisLogBufferService } from './redis-log-buffer.service';

const gzipAsync = promisify(gzip);

function getOffsetDate(date: Date, offsetMinutes: number): Date {
  return new Date(date.getTime() + offsetMinutes * 60000);
}

// 简单的日期格式化函数，避免依赖 date-fns
function formatDate(date: Date, formatStr: string, offsetMinutes = 0): string {
  const targetDate = getOffsetDate(date, offsetMinutes);
  const year = targetDate.getUTCFullYear();
  const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getUTCDate()).padStart(2, '0');
  const hours = String(targetDate.getUTCHours()).padStart(2, '0');
  const minutes = String(targetDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(targetDate.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(targetDate.getUTCMilliseconds()).padStart(3, '0');

  return formatStr
    .replace('yyyy', String(year))
    .replace('MM', month)
    .replace('dd', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
    .replace('SSS', milliseconds);
}

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  LOG = 2,
  DEBUG = 3,
  VERBOSE = 4,
}

@Injectable()
export class LoggerService implements NestLoggerService, OnModuleDestroy {
  private logLevel: LogLevel;
  private logDir: string;
  private readonly timezoneOffsetMinutes: number;
  private readonly enableFileOutput: boolean;
  private readonly enableStdoutOutput: boolean;
  private errorLogStream: NodeJS.WritableStream;
  private combinedLogStream: NodeJS.WritableStream;
  private currentDate: string;

  // 分离的写入队列
  private errorWriteQueue: string[] = [];
  private combinedWriteQueue: string[] = [];

  // 内存队列保护配置
  private readonly maxQueueSize: number;

  // 压缩归档配置
  private readonly enableCompression: boolean;
  private readonly archiveAfterDays: number;
  private readonly cleanAfterDays: number;

  // 缓存的配置值（避免每次读取环境变量）
  private readonly samplingRate: number;
  private readonly logFormat: string;
  private readonly sensitiveFields: string[];

  // 定时器引用（用于清理）
  private rotationTimer: NodeJS.Timeout | null = null;
  private archiveTimer: NodeJS.Timeout | null = null;
  private archiveIntervalTimer: NodeJS.Timeout | null = null;

  constructor(
    @Optional()
    @Inject(RedisLogBufferService)
    private readonly redisBuffer?: RedisLogBufferService,
  ) {
    // 缓存所有配置值（避免每次日志调用都读取环境变量）
    this.maxQueueSize = parseInt(process.env.LOG_MAX_QUEUE_SIZE || '10000');
    this.enableCompression = process.env.LOG_ENABLE_COMPRESSION !== 'false';
    this.archiveAfterDays = parseInt(process.env.LOG_ARCHIVE_AFTER_DAYS || '7');
    this.cleanAfterDays = parseInt(process.env.LOG_CLEAN_AFTER_DAYS || '30');
    this.samplingRate = parseFloat(process.env.LOG_SAMPLING_RATE || '1');
    this.logFormat = process.env.LOG_FORMAT || 'text';
    const timezoneOffset = parseInt(
      process.env.LOG_TIMEZONE_OFFSET || '480',
      10,
    );
    this.timezoneOffsetMinutes = Number.isNaN(timezoneOffset)
      ? 480
      : timezoneOffset;
    this.enableFileOutput = process.env.LOG_FILE !== 'false';
    this.enableStdoutOutput = process.env.LOG_STDOUT !== 'false';
    this.batchSize = parseInt(process.env.LOG_BATCH_SIZE || '50');
    this.batchInterval = parseInt(process.env.LOG_BATCH_INTERVAL || '100');
    this.sensitiveFields = (
      process.env.LOG_SENSITIVE_FIELDS ||
      'password,token,secret,apiKey,authorization'
    )
      .split(',')
      .map((s) => s.trim().toLowerCase());

    // 从环境变量读取日志级别，默认为 LOG
    const envLogLevel = process.env.LOG_LEVEL?.toUpperCase() || 'LOG';
    this.logLevel = LogLevel[envLogLevel] ?? LogLevel.LOG;

    // 设置日志目录
    this.logDir = process.env.LOG_DIR || join(process.cwd(), 'logs');
    this.currentDate = formatDate(
      new Date(),
      'yyyy-MM-dd-HH',
      this.timezoneOffsetMinutes,
    );

    if (this.enableFileOutput) {
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
      }

      // Initialize log streams.
      this.initializeLogStreams();

      // Rotate and archive schedules.
      this.scheduleLogRotation();
      this.scheduleArchive();
    }
  }

  private initializeLogStreams() {
    if (!this.enableFileOutput) {
      return;
    }

    const now = new Date();
    const dayStr = formatDate(now, 'yyyy-MM-dd', this.timezoneOffsetMinutes);
    const hourStr = formatDate(
      now,
      'yyyy-MM-dd-HH',
      this.timezoneOffsetMinutes,
    );
    const dayDir = join(this.logDir, dayStr);
    if (!existsSync(dayDir)) {
      mkdirSync(dayDir, { recursive: true });
    }
    const errorLogPath = join(dayDir, `backend-${hourStr}.error.log`);
    const combinedLogPath = join(dayDir, `backend-${hourStr}.log`);

    // 关闭旧的流
    if (this.errorLogStream) {
      this.errorLogStream.end();
    }
    if (this.combinedLogStream) {
      this.combinedLogStream.end();
    }

    try {
      // 创建新的流（异步模式，增加缓冲区）
      this.errorLogStream = createWriteStream(errorLogPath, {
        flags: 'a',
        highWaterMark: 64 * 1024, // 64KB 缓冲区
      });
      this.combinedLogStream = createWriteStream(combinedLogPath, {
        flags: 'a',
        highWaterMark: 64 * 1024,
      });

      // 监听错误
      this.errorLogStream.on('error', (err) => {
        console.error('Error log stream error:', err);
      });
      this.combinedLogStream.on('error', (err) => {
        console.error('Combined log stream error:', err);
      });

      this.currentDate = hourStr;
    } catch (error) {
      console.error('Failed to initialize log streams:', error);
    }
  }

  private scheduleLogRotation() {
    // 每分钟检查一次是否需要切换日志文件（减少午夜延迟）
    this.rotationTimer = setInterval(() => {
      const now = formatDate(
        new Date(),
        'yyyy-MM-dd-HH',
        this.timezoneOffsetMinutes,
      );
      if (now !== this.currentDate) {
        this.flushQueue().then(() => {
          this.initializeLogStreams();
        });
      }
    }, 60000); // 1分钟
  }

  /**
   * 定时归档和清理任务
   * 每天凌晨2点执行
   */
  private scheduleArchive() {
    const now = new Date();
    const offsetNow = getOffsetDate(now, this.timezoneOffsetMinutes);
    const nextOffsetRun = new Date(offsetNow.getTime());
    nextOffsetRun.setUTCHours(2, 0, 0, 0);

    if (nextOffsetRun.getTime() <= offsetNow.getTime()) {
      nextOffsetRun.setUTCDate(nextOffsetRun.getUTCDate() + 1);
    }

    const nextRun = new Date(
      nextOffsetRun.getTime() - this.timezoneOffsetMinutes * 60000,
    );
    const msUntilArchive = Math.max(0, nextRun.getTime() - now.getTime());

    this.archiveTimer = setTimeout(() => {
      this.runArchiveAndClean();
      // 之后每天执行一次
      this.archiveIntervalTimer = setInterval(() => {
        this.runArchiveAndClean();
      }, 24 * 3600000);
    }, msUntilArchive);
  }

  /**
   * 执行归档和清理
   */
  private async runArchiveAndClean(): Promise<void> {
    await this.archiveOldLogs();
    await this.cleanExpiredLogs();
  }

  private async listFilesRecursive(
    dir: string,
    skipArchiveDir = false,
  ): Promise<string[]> {
    if (!existsSync(dir)) return [];

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (skipArchiveDir && entry.isDirectory() && entry.name === 'archive') {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(
          ...(await this.listFilesRecursive(fullPath, skipArchiveDir)),
        );
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 压缩归档旧日志
   * 将 N 天前的日志压缩到 archive/ 目录
   */
  private async archiveOldLogs(): Promise<void> {
    if (!this.enableCompression) return;

    try {
      const files = await this.listFilesRecursive(this.logDir, true);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.archiveAfterDays);

      for (const filePath of files) {
        if (!filePath.endsWith('.log')) continue;

        const stats = await fs.stat(filePath);

        if (stats.mtime < cutoffDate) {
          const archivePath = `${filePath}.gz`;
          if (existsSync(archivePath)) {
            continue;
          }

          try {
            const content = await fs.readFile(filePath);
            const compressed = await gzipAsync(content);
            await fs.writeFile(archivePath, compressed);

            await fs.unlink(filePath);
            console.log(`[LoggerService] Archived log file: ${filePath}`);
          } catch (err) {
            console.error(
              `[LoggerService] Failed to archive ${filePath}:`,
              err,
            );
          }
        }
      }
    } catch (error) {
      console.error('[LoggerService] Failed to archive logs:', error);
    }
  }

  /**
   * 清理过期的归档日志
   * 删除超过 cleanAfterDays 天的 .gz 文件
   */
  private async cleanExpiredLogs(): Promise<void> {
    try {
      const files = await this.listFilesRecursive(this.logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.cleanAfterDays);

      for (const filePath of files) {
        if (!filePath.endsWith('.gz')) continue;

        const stats = await fs.stat(filePath);

        if (stats.mtime < cutoffDate) {
          try {
            await fs.unlink(filePath);
            console.log(`[LoggerService] Deleted expired archive: ${filePath}`);
          } catch (err) {
            console.error(`[LoggerService] Failed to delete ${filePath}:`, err);
          }
        }
      }
    } catch (error) {
      console.error('[LoggerService] Failed to clean expired logs:', error);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (level > this.logLevel) return false;

    // 错误日志始终记录（不采样）
    if (level === LogLevel.ERROR) return true;

    // 其他日志按采样率记录（使用缓存的配置值）
    return Math.random() < this.samplingRate;
  }

  private formatMessage(
    level: string,
    context: string,
    message: any,
    ...optionalParams: any[]
  ): string {
    const timestamp = formatDate(
      new Date(),
      'yyyy-MM-dd HH:mm:ss.SSS',
      this.timezoneOffsetMinutes,
    );
    const contextStr = context || 'Application';

    // 支持 JSON 格式输出（使用缓存的配置值）
    if (this.logFormat === 'json') {
      const logEntry = {
        timestamp,
        level,
        context: contextStr,
        message:
          typeof message === 'string' ? message : JSON.stringify(message),
        data: optionalParams.length > 0 ? optionalParams : undefined,
      };
      return JSON.stringify(logEntry);
    }

    // 文本格式（默认）
    const messageStr =
      typeof message === 'string' ? message : JSON.stringify(message, null, 2);
    const paramsStr =
      optionalParams.length > 0
        ? ' ' +
          optionalParams
            .map((p) =>
              typeof p === 'string' ? p : JSON.stringify(p, null, 2),
            )
            .join(' ')
        : '';

    return `[${timestamp}] ${level} [${contextStr}] ${messageStr}${paramsStr}`;
  }

  private writeTimer: NodeJS.Timeout | null = null;
  // 使用 Promise 链序列化写入操作（避免竞态条件）
  private flushPromise: Promise<void> = Promise.resolve();
  private readonly batchSize: number;
  private readonly batchInterval: number;

  private flushQueue(): Promise<void> {
    // 使用 Promise 链确保写入操作串行执行
    this.flushPromise = this.flushPromise.then(() => this.doFlush());
    return this.flushPromise;
  }

  private async doFlush(): Promise<void> {
    if (
      this.errorWriteQueue.length === 0 &&
      this.combinedWriteQueue.length === 0
    )
      return;
    if (
      !this.enableFileOutput ||
      !this.errorLogStream ||
      !this.combinedLogStream
    )
      return;

    const errorMessagesToWrite = [...this.errorWriteQueue];
    const combinedMessagesToWrite = [...this.combinedWriteQueue];
    this.errorWriteQueue = [];
    this.combinedWriteQueue = [];

    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    try {
      // 异步批量写入
      const writePromises: Promise<void>[] = [];

      if (combinedMessagesToWrite.length > 0) {
        writePromises.push(
          new Promise<void>((resolve, reject) => {
            this.combinedLogStream.write(
              combinedMessagesToWrite.join(''),
              (err) => {
                if (err) reject(err);
                else resolve();
              },
            );
          }),
        );
      }

      if (errorMessagesToWrite.length > 0) {
        writePromises.push(
          new Promise<void>((resolve, reject) => {
            this.errorLogStream.write(errorMessagesToWrite.join(''), (err) => {
              if (err) reject(err);
              else resolve();
            });
          }),
        );
      }

      await Promise.all(writePromises);
    } catch (error) {
      // 写入失败时降级到控制台
      console.error('Log write failed, falling back to console:', error);
      errorMessagesToWrite.forEach((msg) => console.error(msg.trim()));
      combinedMessagesToWrite.forEach((msg) => console.log(msg.trim()));
    }
  }

  private enqueueLog(message: string, isError: boolean = false) {
    if (!this.enableFileOutput) {
      return;
    }
    // 优先尝试写入 Redis（异步背压缓冲）
    if (this.redisBuffer?.isReady()) {
      this.redisBuffer.pushLog(message.trim()).catch((err) => {
        // Redis 写入失败，降级到内存队列
        console.error(
          '[LoggerService] Redis push failed, fallback to memory:',
          err,
        );
        this.enqueueToMemory(message, isError);
      });
    } else {
      // Redis 不可用，直接使用内存队列
      this.enqueueToMemory(message, isError);
    }
  }

  private enqueueToMemory(message: string, isError: boolean = false) {
    // 内存保护：队列满时丢弃最旧的非错误日志
    const totalQueueSize =
      this.combinedWriteQueue.length + this.errorWriteQueue.length;
    if (totalQueueSize >= this.maxQueueSize) {
      // 丢弃最旧的日志（优先保留错误日志）
      if (this.combinedWriteQueue.length > this.errorWriteQueue.length) {
        this.combinedWriteQueue.shift();
      }
      // 每100次丢弃打印一次警告，避免日志爆炸
      if (totalQueueSize % 100 === 0) {
        console.warn(
          `[LoggerService] Queue full (${totalQueueSize}/${this.maxQueueSize}), dropping oldest logs`,
        );
      }
    }

    // 所有日志都写入 combined 队列
    this.combinedWriteQueue.push(message);

    // ERROR 日志额外写入 error 队列
    if (isError) {
      this.errorWriteQueue.push(message);
    }

    // 如果队列达到批量大小，立即刷新
    if (this.combinedWriteQueue.length >= this.batchSize) {
      this.flushQueue();
    } else if (!this.writeTimer) {
      // 设置定时器，定期刷新
      this.writeTimer = setTimeout(() => {
        this.flushQueue();
      }, this.batchInterval);
    }
  }

  /**
   * 过滤敏感信息（使用缓存的配置值）
   * 公开方法供 AppLogger 调用
   */
  public filterSensitiveData(data: any, seen?: WeakSet<object>): any {
    if (!data || typeof data !== 'object') return data;

    // 初始化循环引用检测集合
    if (!seen) {
      seen = new WeakSet();
    }

    // 检测循环引用，避免无限递归
    if (seen.has(data)) {
      return '[Circular Reference]';
    }
    seen.add(data);

    const filtered = Array.isArray(data) ? [...data] : { ...data };

    for (const key in filtered) {
      const lowerKey = key.toLowerCase();
      if (this.sensitiveFields.some((field) => lowerKey.includes(field))) {
        filtered[key] = '***REDACTED***';
      } else if (typeof filtered[key] === 'object' && filtered[key] !== null) {
        filtered[key] = this.filterSensitiveData(filtered[key], seen);
      }
    }

    return filtered;
  }

  private writeLog(
    level: string,
    context: string,
    message: any,
    ...optionalParams: any[]
  ) {
    // 过滤敏感信息
    const filteredParams =
      optionalParams.length > 0
        ? optionalParams.map((p) => this.filterSensitiveData(p))
        : undefined;

    const formattedMessage = this.formatMessage(
      level,
      context,
      message,
      ...(filteredParams || []),
    );

    // 写入控制台
    if (this.enableStdoutOutput) {
      if (level === 'ERROR') {
        console.error(formattedMessage);
      } else if (level === 'WARN') {
        console.warn(formattedMessage);
      } else {
        console.log(formattedMessage);
      }
    }

    // 加入写入队列（异步批量写入）
    const fileMessage = formattedMessage + '\n';
    this.enqueueLog(fileMessage, level === 'ERROR');
  }

  log(message: any, context?: string, ...optionalParams: any[]) {
    if (this.shouldLog(LogLevel.LOG)) {
      this.writeLog(
        'LOG',
        context || 'Application',
        message,
        ...optionalParams,
      );
    }
  }

  error(
    message: any,
    trace?: string,
    context?: string,
    ...optionalParams: any[]
  ) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorMessage = trace ? `${message}\n${trace}` : message;
      this.writeLog(
        'ERROR',
        context || 'Application',
        errorMessage,
        ...optionalParams,
      );
    }
  }

  warn(message: any, context?: string, ...optionalParams: any[]) {
    if (this.shouldLog(LogLevel.WARN)) {
      this.writeLog(
        'WARN',
        context || 'Application',
        message,
        ...optionalParams,
      );
    }
  }

  debug(message: any, context?: string, ...optionalParams: any[]) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.writeLog(
        'DEBUG',
        context || 'Application',
        message,
        ...optionalParams,
      );
    }
  }

  verbose(message: any, context?: string, ...optionalParams: any[]) {
    if (this.shouldLog(LogLevel.VERBOSE)) {
      this.writeLog(
        'VERBOSE',
        context || 'Application',
        message,
        ...optionalParams,
      );
    }
  }

  setLogLevel(level: LogLevel) {
    this.logLevel = level;
  }

  getLogLevel(): LogLevel {
    return this.logLevel;
  }

  /**
   * 写入格式化后的日志（供 AppLogger 调用）
   * 接收已格式化的 JSON 日志字符串，直接写入文件
   *
   * @param level 日志级别
   * @param formattedLog 已格式化的 JSON 日志字符串
   */
  public writeFormattedLog(level: string, formattedLog: string): void {
    const isError = level === 'ERROR';

    if (this.enableFileOutput) {
      const fileMessage = formattedLog + '\n';
      this.enqueueLog(fileMessage, isError);
    }

    if (this.enableStdoutOutput && process.env.NODE_ENV !== 'development') {
      if (level === 'ERROR') {
        console.error(formattedLog);
      } else {
        console.log(formattedLog);
      }
    }
  }

  async onModuleDestroy() {
    // Clear timers.
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
    if (this.archiveTimer) {
      clearTimeout(this.archiveTimer);
      this.archiveTimer = null;
    }
    if (this.archiveIntervalTimer) {
      clearInterval(this.archiveIntervalTimer);
      this.archiveIntervalTimer = null;
    }
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    if (this.enableFileOutput) {
      await this.flushQueue();

      if (this.errorLogStream) {
        this.errorLogStream.end();
      }
      if (this.combinedLogStream) {
        this.combinedLogStream.end();
      }
    }
  }
}
