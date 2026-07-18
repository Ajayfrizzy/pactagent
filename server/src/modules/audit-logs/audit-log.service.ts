import type { Request } from 'express';
import { createInfrastructureAuditLog, listAuditLogsForApp } from './audit-log.repository';
import { serializeAuditLog } from './audit-log.model';

export function createAuditLogForRequest(req: Request, params: {
  appId?: string | null;
  agreementId?: string | null;
  actorType?: 'api_key' | 'user' | 'system' | 'agent';
  actorId?: string | null;
  actorAddress?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}) {
  return createInfrastructureAuditLog({
    ...params,
    actorType: params.actorType ?? (req.apiKey ? 'api_key' : 'user'),
    actorId: params.actorId ?? req.apiKey?.id ?? null,
    actorAddress: params.actorAddress ?? req.auth?.address ?? null,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
  });
}

export async function listAppAuditLogs(appId: string, params: { limit: number; cursor?: string }) {
  const rows = await listAuditLogsForApp(appId, params);
  const hasMore = rows.length > params.limit;
  const data = rows.slice(0, params.limit);

  return {
    data: data.map(serializeAuditLog),
    pagination: {
      limit: params.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}
