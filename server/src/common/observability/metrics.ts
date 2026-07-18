import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: 'pactagent_' });

export const httpRequests = new Counter({
  name: 'pactagent_http_requests_total',
  help: 'HTTP requests handled by status, method, and route.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry],
});
export const httpDuration = new Histogram({
  name: 'pactagent_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});
export const workerHeartbeatAge = new Gauge({
  name: 'pactagent_worker_heartbeat_age_seconds',
  help: 'Age of the freshest worker heartbeat.',
  registers: [metricsRegistry],
});
export const queuedJobs = new Gauge({
  name: 'pactagent_jobs_queued',
  help: 'Jobs currently queued or waiting for retry.',
  registers: [metricsRegistry],
});
export const deadLetterJobs = new Gauge({
  name: 'pactagent_jobs_dead_letter_total',
  help: 'Jobs currently in the dead-letter state.',
  registers: [metricsRegistry],
});
export const oldestQueuedJobAge = new Gauge({
  name: 'pactagent_oldest_queued_job_age_seconds',
  help: 'Age of the oldest available queued job.',
  registers: [metricsRegistry],
});
export const workerCycles = new Gauge({
  name: 'pactagent_worker_cycles_total',
  help: 'Worker cycles recorded by the latest worker heartbeat.',
  labelNames: ['outcome'] as const,
  registers: [metricsRegistry],
});
export const dbPoolConnections = new Gauge({
  name: 'pactagent_db_pool_connections',
  help: 'Database pool connections by state.',
  labelNames: ['state'] as const,
  registers: [metricsRegistry],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const route = req.route?.path || req.path || 'unknown';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequests.inc(labels);
    httpDuration.observe(labels, Number(process.hrtime.bigint() - startedAt) / 1e9);
  });
  next();
}
