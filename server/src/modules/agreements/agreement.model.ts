import { isAgreementStatus } from './agreement.state-machine';

type AgreementRecord = {
  id: string;
  appId: string | null;
  externalReferenceId: string | null;
  title: string;
  description: string;
  clientExternalId: string | null;
  workerExternalId: string | null;
  status: string;
  amount: string;
  currency: string;
  infrastructureReleaseMode: string | null;
  disputeMode: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
  milestones?: Array<{
    id: string;
    amount: string;
    status: string;
  }>;
};

function parseMetadata(value: string | null) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeStatus(status: string) {
  return isAgreementStatus(status) ? status : status.toLowerCase();
}

export function serializeAgreement(agreement: AgreementRecord) {
  return {
    id: agreement.id,
    appId: agreement.appId,
    externalReferenceId: agreement.externalReferenceId,
    title: agreement.title,
    description: agreement.description,
    clientExternalId: agreement.clientExternalId,
    workerExternalId: agreement.workerExternalId,
    status: normalizeStatus(agreement.status),
    totalAmount: agreement.amount,
    currency: agreement.currency,
    releaseMode: agreement.infrastructureReleaseMode ?? 'milestone',
    disputeMode: agreement.disputeMode ?? 'app_managed',
    sourceType: agreement.sourceType,
    sourceUrl: agreement.sourceUrl,
    metadata: parseMetadata(agreement.metadataJson),
    milestoneSummary: agreement.milestones
      ? {
          count: agreement.milestones.length,
          totalAmount: agreement.milestones
            .reduce((sum, milestone) => sum + BigInt(milestone.amount), BigInt(0))
            .toString(),
        }
      : undefined,
    createdAt: agreement.createdAt.toISOString(),
    updatedAt: agreement.updatedAt.toISOString(),
  };
}
