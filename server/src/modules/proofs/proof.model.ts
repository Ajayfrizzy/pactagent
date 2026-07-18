export type ProofRecord = {
  id: string;
  appId: string | null;
  agreementId: string;
  milestoneId: string;
  submittedByExternalId: string | null;
  proofType: string;
  content: string;
  contentHash: string;
  linksJson: string | null;
  fileRefsJson: string | null;
  status: string;
  submittedAt: Date;
  updatedAt: Date;
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

export function serializeProof(proof: ProofRecord) {
  return {
    id: proof.id,
    appId: proof.appId,
    agreementId: proof.agreementId,
    milestoneId: proof.milestoneId,
    submittedByExternalId: proof.submittedByExternalId,
    type: proof.proofType,
    content: proof.content,
    contentHash: proof.contentHash,
    links: parseJsonArray(proof.linksJson),
    fileRefs: parseJsonArray(proof.fileRefsJson),
    status: proof.status,
    submittedAt: proof.submittedAt.toISOString(),
    updatedAt: proof.updatedAt.toISOString(),
  };
}
