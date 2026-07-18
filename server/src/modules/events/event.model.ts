export type EventRecord = {
  id: string;
  appId: string;
  type: string;
  agreementId: string | null;
  milestoneId: string | null;
  escrowId: string | null;
  proofSubmissionId: string | null;
  disputeId: string | null;
  payloadJson: string;
  createdAt: Date;
};

function parsePayload(payloadJson: string) {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return {};
  }
}

export function serializeEvent(event: EventRecord) {
  return {
    id: event.id,
    appId: event.appId,
    type: event.type,
    agreementId: event.agreementId,
    milestoneId: event.milestoneId,
    escrowId: event.escrowId,
    proofSubmissionId: event.proofSubmissionId,
    disputeId: event.disputeId,
    payload: parsePayload(event.payloadJson),
    createdAt: event.createdAt.toISOString(),
  };
}
