import { AgentJob, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../db';

export type AgentJobKind =
  | 'AGREEMENT_CONTINUE'
  | 'VERIFY_FUNDING'
  | 'RECONCILE_SETTLEMENT'
  | 'DISPUTE_RECOMMENDATION'
  | 'REMINDER_DEADLINE'
  | 'REMINDER_DISPUTE_RESPONSE'
  | 'DELIVER_WEBHOOK'
  | 'SYNC_SOURCE_THREAD';

export type AgentJobPayload = {
  agreementId?: string;
  milestoneId?: string;
  disputeId?: string;
  deliveryId?: string;
  forumThreadUrl?: string;
  manualSummary?: string;
  sourceSyncMode?: 'MANUAL' | 'SCHEDULED';
  note?: string;
};

const DEFAULT_MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 15 * 60_000;

export type WorkerQueue = 'settlement' | 'webhook' | 'ai';

export function queueForJobKind(kind: AgentJobKind): WorkerQueue {
  if (kind === 'DELIVER_WEBHOOK') return 'webhook';
  if (kind === 'DISPUTE_RECOMMENDATION') return 'ai';
  return 'settlement';
}

export function getJobRetryDelayMs(attempt: number, random = Math.random) {
  const exponential = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)));
  return Math.min(RETRY_MAX_MS, Math.round(exponential * (0.5 + random())));
}

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
        queue: queueForJobKind(params.kind),
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
            queue: queueForJobKind(params.kind),
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

export async function claimAvailableJobs(
  workerId: string,
  queues: WorkerQueue[],
  limit = 10,
  leaseMs = 60_000,
) {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const boundedLeaseMs = Math.min(Math.max(Math.trunc(leaseMs), 10_000), 15 * 60_000);
  if (queues.length === 0) return [];

  return prisma.$queryRawUnsafe<AgentJob[]>(`
    WITH candidates AS (
      SELECT id
      FROM "AgentJob"
      WHERE queue = ANY($1::text[])
        AND status IN ('QUEUED', 'RETRY')
        AND "availableAt" <= now()
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now())
      ORDER BY "availableAt", "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    )
    UPDATE "AgentJob" job
    SET status = 'RUNNING',
        "lockedAt" = now(),
        "lockedBy" = $3,
        "leaseExpiresAt" = now() + ($4 * interval '1 millisecond'),
        attempts = job.attempts + 1,
        "updatedAt" = now()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  `, queues, boundedLimit, workerId, boundedLeaseMs);
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

export async function completeJob(jobId: string, workerId: string) {
  const result = await prisma.agentJob.updateMany({
    where: { id: jobId, status: 'RUNNING', lockedBy: workerId },
    data: {
      status: 'COMPLETED',
      dedupeKey: null,
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
      completedAt: new Date(),
      lastError: null,
    },
  });
  if (result.count !== 1) throw new Error(`Job ${jobId} lease is no longer owned by ${workerId}.`);
  return result;
}

export async function failJob(job: {
  id: string;
  attempts: number;
  maxAttempts: number;
}, workerId: string, error: string) {
  const shouldDeadLetter = job.attempts >= job.maxAttempts;
  const delayMs = getJobRetryDelayMs(job.attempts);
  const result = await prisma.agentJob.updateMany({
    where: { id: job.id, status: 'RUNNING', lockedBy: workerId },
    data: shouldDeadLetter
      ? {
          status: 'DEAD_LETTER',
          dedupeKey: null,
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: error,
          deadLetteredAt: new Date(),
        }
      : {
          status: 'RETRY',
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: error,
          availableAt: new Date(Date.now() + delayMs),
        },
  });
  if (result.count !== 1) throw new Error(`Job ${job.id} lease is no longer owned by ${workerId}.`);
  return { ...result, deadLettered: shouldDeadLetter, retryDelayMs: shouldDeadLetter ? null : delayMs };
}

export async function renewJobLease(jobId: string, workerId: string, leaseMs: number) {
  const leaseExpiresAt = new Date(Date.now() + leaseMs);
  const result = await prisma.agentJob.updateMany({
    where: { id: jobId, status: 'RUNNING', lockedBy: workerId },
    data: { leaseExpiresAt },
  });
  if (result.count !== 1) throw new Error(`Job ${jobId} lease renewal was rejected for ${workerId}.`);
  return leaseExpiresAt;
}

export async function listAgreementJobs(agreementId: string, limit = 100) {
  return prisma.agentJob.findMany({
    where: { agreementId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
}

export async function replayJob(jobId: string, agreementId: string) {
  const job = await prisma.agentJob.findUnique({ where: { id: jobId } });
  if (!job || job.agreementId !== agreementId) {
    throw new Error(`Job ${jobId} not found`);
  }
  if (!['COMPLETED', 'DEAD_LETTER'].includes(job.status)) {
    throw new Error(`Job ${jobId} cannot be replayed from status ${job.status}.`);
  }

  return prisma.agentJob.create({
    data: {
      id: randomUUID(),
      agreementId: job.agreementId,
      kind: job.kind,
      status: 'QUEUED',
      queue: job.queue,
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
      OR: [
        { leaseExpiresAt: { lt: new Date() } },
        { leaseExpiresAt: null, lockedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: 'RETRY',
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
      availableAt: new Date(),
      lastError: 'Recovered stale worker lock.',
    },
  });
}
