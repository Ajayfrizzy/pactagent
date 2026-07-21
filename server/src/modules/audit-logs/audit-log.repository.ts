import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import type { TenantContext } from '../../common/tenancy/tenant-context';

export type CreateInfrastructureAuditLogInput = {
  appId?: string | null;
  agreementId?: string | null;
  actorType: 'api_key' | 'user' | 'system' | 'agent';
  actorId?: string | null;
  actorAddress?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

function serializeJson(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

export function createInfrastructureAuditLog(
  input: CreateInfrastructureAuditLogInput,
  tx?: Prisma.TransactionClient,
) {
  return (tx ?? prisma).auditLog.create({
    data: {
      appId: input.appId ?? null,
      agreementId: input.agreementId ?? null,
      actorAddress: input.actorAddress ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.targetType,
      resourceId: input.targetId,
      targetType: input.targetType,
      targetId: input.targetId,
      beforeJson: serializeJson(input.before),
      afterJson: serializeJson(input.after),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    },
  });
}

export function listAuditLogsForApp(tenant: TenantContext, params: { limit: number; cursor?: string }) {
  return prisma.auditLog.findMany({
    where: { appId: tenant.appId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}
