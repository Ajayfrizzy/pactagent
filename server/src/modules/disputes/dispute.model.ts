export type DisputeRecord = {
  id: string;
  appId: string | null;
  agreementId: string;
  milestoneId: string;
  openedByExternalId: string | null;
  openedBy: string;
  reason: string;
  evidenceLinksJson: string | null;
  status: string;
  resolutionType: string | null;
  resolutionNote: string | null;
  workerAmount: string | null;
  clientAmount: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

function parseJsonArray(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeDispute(dispute: DisputeRecord) {
  return {
    id: dispute.id,
    appId: dispute.appId,
    agreementId: dispute.agreementId,
    milestoneId: dispute.milestoneId,
    openedByExternalId: dispute.openedByExternalId,
    reason: dispute.reason,
    evidenceLinks: parseJsonArray(dispute.evidenceLinksJson),
    status: dispute.status,
    resolutionType: dispute.resolutionType,
    resolutionNote: dispute.resolutionNote,
    workerAmount: dispute.workerAmount,
    clientAmount: dispute.clientAmount,
    createdAt: dispute.createdAt.toISOString(),
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
  };
}
