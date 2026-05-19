import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

/**
 * TraceId 管理服务
 * 使用 AsyncLocalStorage 实现 MDC（Mapped Diagnostic Context）
 * 自动在异步调用链中传递 traceId 和 userId
 */
@Injectable()
export class TraceService {
  private readonly asyncLocalStorage = new AsyncLocalStorage<
    Map<string, any>
  >();

  /**
   * 启动一个新的追踪上下文
   * 自动生成 traceId
   *
   * 如果已存在上下文，则复用现有 store，避免重置 traceId
   */
  run<T>(callback: () => T): T {
    const existingStore = this.asyncLocalStorage.getStore();

    // 如果已有上下文，直接执行回调，避免重置 traceId
    if (existingStore) {
      return callback();
    }

    // 创建新的上下文
    const store = new Map<string, any>();
    store.set('traceId', uuidv4());
    store.set('startTime', Date.now());
    return this.asyncLocalStorage.run(store, callback);
  }

  /**
   * 获取当前上下文的 traceId
   */
  getTraceId(): string | undefined {
    return this.asyncLocalStorage.getStore()?.get('traceId');
  }

  /**
   * 设置当前上下文的 userId
   */
  setUserId(userId: string): void {
    this.asyncLocalStorage.getStore()?.set('userId', userId);
  }

  /**
   * 获取当前上下文的 userId
   */
  getUserId(): string | undefined {
    return this.asyncLocalStorage.getStore()?.get('userId');
  }

  /**
   * 设置当前上下文的 caller 类型
   */
  setCaller(caller: 'USER' | 'AI' | 'SYSTEM'): void {
    this.asyncLocalStorage.getStore()?.set('caller', caller);
  }

  /**
   * 获取当前上下文的 caller 类型
   */
  getCaller(): 'USER' | 'AI' | 'SYSTEM' | undefined {
    return this.asyncLocalStorage.getStore()?.get('caller');
  }

  /**
   * 设置请求开始时间
   */
  setStartTime(time: number): void {
    this.asyncLocalStorage.getStore()?.set('startTime', time);
  }

  /**
   * 获取请求开始时间
   */
  getStartTime(): number | undefined {
    return this.asyncLocalStorage.getStore()?.get('startTime');
  }

  /**
   * 计算从开始到现在的耗时（毫秒）
   */
  getCostMs(): number {
    const startTime = this.getStartTime();
    return startTime ? Date.now() - startTime : 0;
  }

  /**
   * 设置自定义上下文数据
   */
  set(key: string, value: any): void {
    this.asyncLocalStorage.getStore()?.set(key, value);
  }

  /**
   * 获取自定义上下文数据
   */
  get(key: string): any {
    return this.asyncLocalStorage.getStore()?.get(key);
  }

  /**
   * 获取所有上下文数据
   */
  getAll(): Record<string, any> {
    const store = this.asyncLocalStorage.getStore();
    if (!store) return {};

    const result: Record<string, any> = {};
    store.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}
