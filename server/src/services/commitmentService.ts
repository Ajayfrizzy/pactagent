import { createHash } from 'crypto';

type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike };

function canonicalize(value: JsonLike): JsonLike {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    const sortedEntries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, canonicalize(nestedValue)] as const);

    return Object.fromEntries(sortedEntries);
  }

  return value;
}

function digest(value: JsonLike) {
  const payload = JSON.stringify(canonicalize(value));
  return createHash('sha256').update(payload).digest('hex');
}

export function buildMilestoneDigest(
  milestones: Array<{
    title: string;
    description: string;
    amount: string;
    sortOrder: number;
  }>
) {
  return digest({
    milestones: milestones.map((milestone) => ({
      sortOrder: milestone.sortOrder,
      title: milestone.title.trim(),
      description: milestone.description.trim(),
      amount: milestone.amount,
    })),
  });
}

export function buildSingleMilestoneDigest(milestone: {
  title: string;
  description: string;
  amount: string;
  sortOrder: number;
}) {
  return buildMilestoneDigest([milestone]);
}

export function buildAgreementDigest(input: {
  title: string;
  description: string;
  clientAddress: string;
  workerAddress: string;
  workerFiberPubkey: string | null;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: string;
  reviewerMode: string;
  releaseMode: string;
  payoutNetwork: string;
  milestoneDigest: string;
}) {
  return digest({
    title: input.title.trim(),
    description: input.description.trim(),
    clientAddress: input.clientAddress.trim(),
    workerAddress: input.workerAddress.trim(),
    workerFiberPubkey: input.workerFiberPubkey?.trim() || null,
    deadlineAt: new Date(input.deadlineAt).toISOString(),
    disputeWindowSecs: input.disputeWindowSecs,
    proofType: input.proofType,
    reviewerMode: input.reviewerMode,
    releaseMode: input.releaseMode,
    payoutNetwork: input.payoutNetwork,
    milestoneDigest: input.milestoneDigest,
  });
}
