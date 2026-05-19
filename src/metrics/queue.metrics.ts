import { Gauge, Histogram, Counter, register } from 'prom-client';

const PREFIX = 'game_ai_cs_';

export const queueLengthGauge = new Gauge({
  name: `${PREFIX}queue_length`,
  help: 'Current number of sessions in queue',
  labelNames: ['queue_type'],
  registers: [register],
});

export const queueWaitTimeHistogram = new Histogram({
  name: `${PREFIX}queue_wait_time_seconds`,
  help: 'Time spent waiting in queue before agent assignment',
  labelNames: ['queue_type'],
  buckets: [5, 10, 30, 60, 120, 300, 600, 1800],
  registers: [register],
});

export const redisConnectionErrorsCounter = new Counter({
  name: `${PREFIX}redis_connection_errors_total`,
  help: 'Total number of Redis connection errors',
  labelNames: ['error_type'],
  registers: [register],
});

export const wsConnectionsGauge = new Gauge({
  name: `${PREFIX}ws_connections_active`,
  help: 'Current number of active WebSocket connections',
  labelNames: ['client_type'],
  registers: [register],
});

export const wsMessagesCounter = new Counter({
  name: `${PREFIX}ws_messages_total`,
  help: 'Total number of WebSocket messages',
  labelNames: ['direction'],
  registers: [register],
});

export const httpRequestsCounter = new Counter({
  name: `${PREFIX}http_requests_total`,
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestDurationHistogram = new Histogram({
  name: `${PREFIX}http_request_duration_seconds`,
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

export const rateLimitRejectedCounter = new Counter({
  name: `${PREFIX}rate_limit_rejected_total`,
  help: 'Total number of rate limited requests',
  labelNames: ['type', 'endpoint', 'user_role'],
  registers: [register],
});
