import type { Request, Response } from 'express';
import { sendSuccess } from '../../common/middleware/response';
import * as healthService from './health.service';
import { config } from '../../config';
import { metricsRegistry } from '../../common/observability/metrics';

export function health(_req: Request, res: Response) {
  return sendSuccess(res, healthService.getHealthStatus());
}

export async function metrics(req: Request, res: Response) {
  if (config.metricsBearerToken && req.header('authorization') !== `Bearer ${config.metricsBearerToken}`) {
    return res.status(401).type('text/plain').send('Unauthorized');
  }
  await healthService.getWorkerAndQueueStatus();
  res.setHeader('Content-Type', metricsRegistry.contentType);
  return res.send(await metricsRegistry.metrics());
}

export async function ready(_req: Request, res: Response) {
  const readiness = await healthService.getReadinessStatus();
  return sendSuccess(res, readiness, readiness.status === 'ready' ? 200 : 503);
}

export async function worker(_req: Request, res: Response) {
  const status = await healthService.getWorkerAndQueueStatus();
  return sendSuccess(res, {
    ...status,
    version: config.buildVersion,
    commit: config.buildCommit,
    timestamp: new Date().toISOString(),
  }, status.status === 'ok' ? 200 : 503);
}
