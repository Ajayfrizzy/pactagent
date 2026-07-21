import type { Request, Response } from 'express';
import { sendList, sendSuccess } from '../../common/middleware/response';
import { createInfrastructureAuditLog } from '../audit-logs/audit-log.repository';
import * as adminService from './admin.service';

async function auditAdminRead(req: Request, targetType: string) {
  await createInfrastructureAuditLog({
    appId: typeof req.query.appId === 'string' ? req.query.appId : null,
    actorType: 'user',
    actorId: req.auth?.address ?? null,
    actorAddress: req.auth?.address ?? null,
    action: 'admin.sensitive_record_viewed',
    targetType,
    targetId: 'global',
    after: {
      method: req.method,
      path: req.originalUrl,
      query: req.query,
    },
    ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
  });
}

export async function getSystemHealth(req: Request, res: Response) {
  const health = await adminService.getSystemHealth();
  await auditAdminRead(req, 'system_health');
  return sendSuccess(res, health);
}

export async function listApps(req: Request, res: Response) {
  const result = await adminService.listApps(req.query as any);
  await auditAdminRead(req, 'app');
  return sendList(res, result.data, result.pagination);
}

export async function listAgreements(req: Request, res: Response) {
  const result = await adminService.listAgreements(req.query as any);
  await auditAdminRead(req, 'agreement');
  return sendList(res, result.data, result.pagination);
}

export async function listEscrows(req: Request, res: Response) {
  const result = await adminService.listEscrows(req.query as any);
  await auditAdminRead(req, 'escrow');
  return sendList(res, result.data, result.pagination);
}

export async function listEvents(req: Request, res: Response) {
  const result = await adminService.listEvents(req.query as any);
  await auditAdminRead(req, 'event');
  return sendList(res, result.data, result.pagination);
}

export async function listWebhookDeliveries(req: Request, res: Response) {
  const result = await adminService.listWebhookDeliveries(req.query as any);
  await auditAdminRead(req, 'webhook_delivery');
  return sendList(res, result.data, result.pagination);
}

export async function listAuditLogs(req: Request, res: Response) {
  const result = await adminService.listAuditLogs(req.query as any);
  await auditAdminRead(req, 'audit_log');
  return sendList(res, result.data, result.pagination);
}

export async function listJobs(req: Request, res: Response) {
  const result = await adminService.listJobs(req.query as any);
  await auditAdminRead(req, 'agent_job');
  return sendList(res, result.data, result.pagination);
}

export async function replayJob(req: Request, res: Response) {
  const replayed = await adminService.replayDeadLetterJob(req.params.id);
  await createInfrastructureAuditLog({
    actorType: 'user', actorId: req.auth?.address ?? null, actorAddress: req.auth?.address ?? null,
    action: 'admin.agent_job_replayed', targetType: 'agent_job', targetId: req.params.id,
    after: { replayedJobId: replayed.id }, ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? null, requestId: req.requestId,
  });
  return sendSuccess(res, replayed);
}
