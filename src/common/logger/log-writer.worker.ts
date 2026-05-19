/**
 * 日志写入 Worker Thread
 *
 * 功能：
 * 1. 在独立线程中处理日志写入，不阻塞主线程
 * 2. 批量写入文件
 * 3. 处理日志压缩归档任务
 *
 * 消息类型：
 * - write: 批量写入日志
 * - rotate: 轮转日志文件
 * - archive: 压缩归档旧日志
 * - clean: 清理过期日志
 * - shutdown: 关闭 Worker
 */

import { parentPort, workerData } from 'worker_threads';
import { createWriteStream, existsSync, mkdirSync, promises as fs } from 'fs';
import { join } from 'path';
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

interface WorkerMessage {
  type: 'write' | 'rotate' | 'archive' | 'clean' | 'shutdown';
  payload?: any;
  id?: string; // 用于响应确认
}

interface WritePayload {
  combined: string[];
  error: string[];
}

interface ArchivePayload {
  archiveAfterDays: number;
}

interface CleanPayload {
  cleanAfterDays: number;
}

// 简单的日期格式化
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

class LogWriterWorker {
  private logDir: string;
  private currentDate: string;
  private combinedStream: NodeJS.WritableStream | null = null;
  private errorStream: NodeJS.WritableStream | null = null;
  private isShuttingDown = false;

  constructor() {
    this.logDir = workerData?.logDir || join(process.cwd(), 'logs');
    this.currentDate = formatDate(new Date());
    this.ensureLogDir();
    this.initStreams();
    this.listen();
  }

  private ensureLogDir() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private initStreams() {
    const combinedPath = join(this.logDir, `backend-${this.currentDate}.log`);
    const errorPath = join(
      this.logDir,
      `backend-${this.currentDate}.error.log`,
    );

    // 关闭旧流
    this.closeStreams();

    try {
      this.combinedStream = createWriteStream(combinedPath, {
        flags: 'a',
        highWaterMark: 128 * 1024, // 128KB 缓冲区
      });

      this.errorStream = createWriteStream(errorPath, {
        flags: 'a',
        highWaterMark: 64 * 1024,
      });

      this.combinedStream.on('error', (err) => {
        console.error('[LogWriter Worker] Combined stream error:', err);
      });

      this.errorStream.on('error', (err) => {
        console.error('[LogWriter Worker] Error stream error:', err);
      });
    } catch (error) {
      console.error('[LogWriter Worker] Failed to init streams:', error);
    }
  }

  private closeStreams() {
    if (this.combinedStream) {
      this.combinedStream.end();
      this.combinedStream = null;
    }
    if (this.errorStream) {
      this.errorStream.end();
      this.errorStream = null;
    }
  }

  private listen() {
    if (!parentPort) {
      console.error('[LogWriter Worker] No parent port available');
      return;
    }

    parentPort.on('message', async (msg: WorkerMessage) => {
      if (this.isShuttingDown && msg.type !== 'shutdown') {
        return;
      }

      try {
        switch (msg.type) {
          case 'write':
            await this.handleWrite(msg.payload as WritePayload);
            break;
          case 'rotate':
            await this.handleRotate();
            break;
          case 'archive':
            await this.handleArchive(msg.payload as ArchivePayload);
            break;
          case 'clean':
            await this.handleClean(msg.payload as CleanPayload);
            break;
          case 'shutdown':
            await this.handleShutdown();
            break;
        }

        // 发送确认响应
        if (msg.id) {
          parentPort?.postMessage({ type: 'ack', id: msg.id });
        }
      } catch (error) {
        console.error(`[LogWriter Worker] Error handling ${msg.type}:`, error);
        if (msg.id) {
          parentPort?.postMessage({
            type: 'error',
            id: msg.id,
            error: String(error),
          });
        }
      }
    });
  }

  /**
   * 批量写入日志
   */
  private async handleWrite(payload: WritePayload): Promise<void> {
    // 检查是否需要轮转
    const today = formatDate(new Date());
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.initStreams();
    }

    const { combined, error } = payload;

    // 写入 combined 日志
    if (combined.length > 0 && this.combinedStream) {
      const content = combined.join('');
      await this.writeToStream(this.combinedStream, content);
    }

    // 写入 error 日志
    if (error.length > 0 && this.errorStream) {
      const content = error.join('');
      await this.writeToStream(this.errorStream, content);
    }
  }

  private writeToStream(
    stream: NodeJS.WritableStream,
    content: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const canContinue = stream.write(content, 'utf8', (err) => {
        if (err) reject(err);
        else resolve();
      });

      // 处理背压
      if (!canContinue) {
        stream.once('drain', resolve);
      }
    });
  }

  /**
   * 轮转日志文件
   */
  private async handleRotate(): Promise<void> {
    this.currentDate = formatDate(new Date());
    this.initStreams();
  }

  /**
   * 压缩归档旧日志
   */
  private async handleArchive(payload: ArchivePayload): Promise<void> {
    const { archiveAfterDays } = payload;
    const archiveDir = join(this.logDir, 'archive');

    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - archiveAfterDays);

    try {
      const files = await fs.readdir(this.logDir);

      for (const file of files) {
        if (!file.endsWith('.log')) continue;

        const filePath = join(this.logDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime < cutoffDate) {
          // 压缩文件
          const content = await fs.readFile(filePath);
          const compressed = await gzipAsync(content);
          const archivePath = join(archiveDir, `${file}.gz`);
          await fs.writeFile(archivePath, compressed);

          // 删除原文件
          await fs.unlink(filePath);
          console.log(`[LogWriter Worker] Archived: ${file}`);
        }
      }
    } catch (error) {
      console.error('[LogWriter Worker] Archive error:', error);
    }
  }

  /**
   * 清理过期的归档日志
   */
  private async handleClean(payload: CleanPayload): Promise<void> {
    const { cleanAfterDays } = payload;
    const archiveDir = join(this.logDir, 'archive');

    if (!existsSync(archiveDir)) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - cleanAfterDays);

    try {
      const files = await fs.readdir(archiveDir);

      for (const file of files) {
        if (!file.endsWith('.gz')) continue;

        const filePath = join(archiveDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          console.log(`[LogWriter Worker] Cleaned: ${file}`);
        }
      }
    } catch (error) {
      console.error('[LogWriter Worker] Clean error:', error);
    }
  }

  /**
   * 关闭 Worker
   */
  private async handleShutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.closeStreams();
    process.exit(0);
  }
}

// 启动 Worker
new LogWriterWorker();
