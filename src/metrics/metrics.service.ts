import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';
import {
  httpRequestsCounter,
  httpRequestDurationHistogram,
  wsConnectionsGauge,
  wsMessagesCounter,
  rateLimitRejectedCounter,
  queueLengthGauge,
  queueWaitTimeHistogram,
} from './queue.metrics';

const PREFIX = 'game_ai_cs_';

/**
 * 指标服务 - 提供 Prometheus 格式的业务和系统指标
 * 复用 queue.metrics.ts 中已定义的指标，避免重复注册
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  // 业务指标 - 工单
  public ticketsCreatedTotal: client.Counter<string>;
  public ticketsResolvedTotal: client.Counter<string>;
  public ticketsActiveGauge: client.Gauge<string>;

  // 业务指标 - 会话
  public sessionsActiveGauge: client.Gauge<string>;

  // 业务指标 - 消息
  public messagesTotal: client.Counter<string>;

  // Dify AI 指标
  public difyRequestsTotal: client.Counter<string>;
  public difyRequestDuration: client.Histogram<string>;

  // 数据库指标
  public dbQueryDuration: client.Histogram<string>;

  onModuleInit() {
    client.collectDefaultMetrics({ prefix: PREFIX });
    this.initBusinessMetrics();
    this.initDifyMetrics();
    this.initDatabaseMetrics();
  }

  private initBusinessMetrics() {
    this.ticketsCreatedTotal = new client.Counter({
      name: `${PREFIX}tickets_created_total`,
      help: 'Total number of tickets created',
      labelNames: ['priority'],
    });
    this.ticketsResolvedTotal = new client.Counter({
      name: `${PREFIX}tickets_resolved_total`,
      help: 'Total number of tickets resolved',
      labelNames: ['resolution_type'],
    });
    this.ticketsActiveGauge = new client.Gauge({
      name: `${PREFIX}tickets_active`,
      help: 'Number of active tickets',
      labelNames: ['status'],
    });
    this.sessionsActiveGauge = new client.Gauge({
      name: `${PREFIX}sessions_active`,
      help: 'Number of active sessions',
    });
    this.messagesTotal = new client.Counter({
      name: `${PREFIX}messages_total`,
      help: 'Total number of messages',
      labelNames: ['sender_type', 'message_type'],
    });
  }

  private initDifyMetrics() {
    this.difyRequestsTotal = new client.Counter({
      name: `${PREFIX}dify_requests_total`,
      help: 'Total number of Dify API requests',
      labelNames: ['endpoint', 'status'],
    });
    this.difyRequestDuration = new client.Histogram({
      name: `${PREFIX}dify_request_duration_seconds`,
      help: 'Dify API request duration in seconds',
      labelNames: ['endpoint'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
    });
  }

  private initDatabaseMetrics() {
    this.dbQueryDuration = new client.Histogram({
      name: `${PREFIX}db_query_duration_seconds`,
      help: 'Database query duration in seconds',
      labelNames: ['operation'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    });
  }

  // ========== HTTP/WS 指标方法 (使用 queue.metrics.ts 中的指标) ==========
  recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
  ) {
    const normalizedPath = this.normalizePath(path);
    httpRequestsCounter.inc({
      method,
      route: normalizedPath,
      status_code: String(statusCode),
    });
    httpRequestDurationHistogram.observe(
      { method, route: normalizedPath },
      duration,
    );
  }

  incWsConnection(type: string) {
    wsConnectionsGauge.inc({ client_type: type });
  }
  decWsConnection(type: string) {
    wsConnectionsGauge.dec({ client_type: type });
  }
  recordWsMessage(direction: string) {
    wsMessagesCounter.inc({ direction });
  }

  recordRateLimitRejected(
    type: 'http' | 'ws',
    endpoint: string,
    role?: string,
  ) {
    const normalizedEndpoint =
      type === 'http' ? this.normalizePath(endpoint) : endpoint;
    rateLimitRejectedCounter.inc({
      type,
      endpoint: normalizedEndpoint || 'unknown',
      user_role: role || 'unknown',
    });
  }

  // ========== 业务指标方法 ==========
  recordTicketCreated(priority: string) {
    this.ticketsCreatedTotal.inc({ priority });
  }
  recordTicketResolved(resolutionType: string) {
    this.ticketsResolvedTotal.inc({ resolution_type: resolutionType });
  }
  setActiveTickets(status: string, count: number) {
    this.ticketsActiveGauge.set({ status }, count);
  }
  setActiveSessions(count: number) {
    this.sessionsActiveGauge.set(count);
  }
  recordMessage(senderType: string, messageType: string) {
    this.messagesTotal.inc({
      sender_type: senderType,
      message_type: messageType,
    });
  }

  recordDifyRequest(endpoint: string, status: string, duration: number) {
    this.difyRequestsTotal.inc({ endpoint, status });
    if (status === 'success')
      this.difyRequestDuration.observe({ endpoint }, duration);
  }

  // ========== 队列指标方法 (使用 queue.metrics.ts 中的指标) ==========
  setQueueLength(queueType: string, length: number) {
    queueLengthGauge.set({ queue_type: queueType }, length);
  }
  recordQueueWaitTime(queueType: string, waitTime: number) {
    queueWaitTimeHistogram.observe({ queue_type: queueType }, waitTime);
  }

  recordDbQuery(operation: string, duration: number) {
    this.dbQueryDuration.observe({ operation }, duration);
  }

  private normalizePath(path: string): string {
    return path.replace(/\/[0-9a-f-]{36}/gi, '/:id').replace(/\/\d+/g, '/:id');
  }

  getMetrics(): Promise<string> {
    return client.register.metrics();
  }
  getContentType(): string {
    return client.register.contentType;
  }
}
