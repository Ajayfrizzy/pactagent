import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../db';

export type AgentJobKind =
  | 'AGREEMENT_CONTINUE'
  | 'VERIFY_FUNDING'
  | 'RECONCILE_SETTLEMENT'
  | 'DISPUTE_RECOMMENDATION'
  | 'REMINDER_DEADLINE'
  | 'REMINDER_DISPUTE_RESPONSE'
  | 'DELIVER_WEBHOOK';

export type AgentJobPayload = {
  agreementId?: string;
  milestoneId?: string;
  disputeId?: string;
  deliveryId?: string;
  note?: string;
};

const DEFAULT_MAX_ATTEMPTS = 5;

function serializePayload(payload?: AgentJobPayload) {
  return payload ? JSON.stringify(payload) : null;
}

export async function enqueueJob(params: {
  agreementId?: string | null;
  kind: AgentJobKind;
  payload?: AgentJobPayload;
  availableAt?: Date;
  maxAttempts?: number;
  dedupeKey?: string | null;
}) {
  const dedupeKey = params.dedupeKey ?? null;

  if (dedupeKey) {
    const existing = await prisma.agentJob.findFirst({
      where: {
        dedupeKey,
        status: { in: ['QUEUED', 'RUNNING', 'RETRY'] },
      },
    });

    if (existing) {
      return existing;
    }
  }

  try {
    return await prisma.agentJob.create({
      data: {
        id: randomUUID(),
        agreementId: params.agreementId ?? null,
        kind: params.kind,
        status: 'QUEUED',
        dedupeKey,
        payloadJson: serializePayload(params.payload),
        availableAt: params.availableAt ?? new Date(),
        maxAttempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      },
    });
  } catch (error) {
    if (dedupeKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.agentJob.findUnique({
        where: { dedupeKey },
      });

      if (existing && ['QUEUED', 'RUNNING', 'RETRY'].includes(existing.status)) {
        return existing;
      }

      if (existing && ['COMPLETED', 'DEAD_LETTER'].includes(existing.status)) {
        await prisma.agentJob.update({
          where: { id: existing.id },
          data: { dedupeKey: null },
        });

        return prisma.agentJob.create({
          data: {
            id: randomUUID(),
            agreementId: params.agreementId ?? null,
            kind: params.kind,
            status: 'QUEUED',
            dedupeKey,
            payloadJson: serializePayload(params.payload),
            availableAt: params.availableAt ?? new Date(),
            maxAttempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          },
        });
      }
    }

    throw error;
  }
}

export async function enqueueAgreementJob(params: {
  agreementId: string;
  kind: AgentJobKind;
  payload?: AgentJobPayload;
  dedupeSuffix?: string;
  availableAt?: Date;
}) {
  return enqueueJob({
    agreementId: params.agreementId,
    kind: params.kind,
    payload: {
      agreementId: params.agreementId,
      ...(params.payload || {}),
    },
    availableAt: params.availableAt,
    dedupeKey: `${params.kind}:${params.agreementId}:${params.dedupeSuffix || 'default'}`,
  });
}

export async function claimAvailableJobs(workerId: string, limit = 10) {
  const candidates = await prisma.agentJob.findMany({
    where: {
      status: { in: ['QUEUED', 'RETRY'] },
      availableAt: { lte: new Date() },
      lockedAt: null,
    },
    orderBy: [
      { availableAt: 'asc' },
      { createdAt: 'asc' },
    ],
    take: limit,
  });

  const claimed: typeof candidates = [];

  for (const job of candidates) {
    const result = await prisma.agentJob.updateMany({
      where: {
        id: job.id,
        status: { in: ['QUEUED', 'RETRY'] },
        lockedAt: null,
      },
      data: {
        status: 'RUNNING',
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: { increment: 1 },
      },
    });

    if (result.count > 0) {
      claimed.push({
        ...job,
        status: 'RUNNING',
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: job.attempts + 1,
      } as typeof job);
    }
  }

  return claimed;
}

export function parseJobPayload(payloadJson: string | null): AgentJobPayload {
  if (!payloadJson) {
    return {};
  }

  try {
    return JSON.parse(payloadJson) as AgentJobPayload;
  } catch {
    return {};
  }
}

export async function completeJob(jobId: string) {
  return prisma.agentJob.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      dedupeKey: null,
      lockedAt: null,
      lockedBy: null,
      completedAt: new Date(),
      lastError: null,
    },
  });
}

export async function failJob(job: {
  id: string;
  attempts: number;
  maxAttempts: number;
}, error: string) {
  const shouldDeadLetter = job.attempts >= job.maxAttempts;
  const delayMs = Math.min(60_000, Math.max(5_000, job.attempts * 5_000));
  return prisma.agentJob.update({
    where: { id: job.id },
    data: shouldDeadLetter
      ? {
          status: 'DEAD_LETTER',
          dedupeKey: null,
          lockedAt: null,
          lockedBy: null,
          lastError: error,
          deadLetteredAt: new Date(),
        }
      : {
          status: 'RETRY',
          lockedAt: null,
          lockedBy: null,
          lastError: error,
          availableAt: new Date(Date.now() + delayMs),
        },
  });
}

export async function listAgreementJobs(agreementId: string, limit = 100) {
  return prisma.agentJob.findMany({
    where: { agreementId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function replayJob(jobId: string) {
  const job = await prisma.agentJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  return prisma.agentJob.create({
    data: {
      id: randomUUID(),
      agreementId: job.agreementId,
      kind: job.kind,
      status: 'QUEUED',
      dedupeKey: null,
      payloadJson: job.payloadJson,
      maxAttempts: job.maxAttempts,
      availableAt: new Date(),
    },
  });
}

export async function releaseStaleLocks(staleMs = 5 * 60 * 1000) {
  const staleBefore = new Date(Date.now() - staleMs);
  return prisma.agentJob.updateMany({
    where: {
      status: 'RUNNING',
      lockedAt: { lt: staleBefore },
    },
    data: {
      status: 'RETRY',
      lockedAt: null,
      lockedBy: null,
      availableAt: new Date(),
      lastError: 'Recovered stale worker lock.',
    },
  });
}
