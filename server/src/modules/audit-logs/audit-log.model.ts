type AuditLogRecord = {
  id: string;
  appId: string | null;
  agreementId: string | null;
  actorAddress: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  targetType: string | null;
  targetId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
};

function parseJson(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function serializeAuditLog(log: AuditLogRecord) {
  return {
    id: log.id,
    appId: log.appId,
    agreementId: log.agreementId,
    actorType: log.actorType,
    actorId: log.actorId,
    actorAddress: log.actorAddress,
    action: log.action,
    targetType: log.targetType ?? log.resourceType,
    targetId: log.targetId ?? log.resourceId,
    before: parseJson(log.beforeJson),
    after: parseJson(log.afterJson),
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    requestId: log.requestId,
    createdAt: log.createdAt.toISOString(),
  };
}
