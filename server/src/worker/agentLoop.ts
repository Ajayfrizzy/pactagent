import { cleanupExpiredIdempotencyKeys } from '../common/idempotency/idempotency.repository';
import { log } from '../common/observability/logger';
import { jobExecutionDuration, jobLeaseRenewals, jobRetries } from '../common/observability/metrics';
import { runWithJobDeadline } from '../common/runtime/job-deadline';
import { config } from '../config';
import { deliverWebhookDelivery } from '../modules/webhooks/webhook.service';
import {
  claimAvailableJobs,
  completeJob,
  failJob,
  parseJobPayload,
  releaseStaleLocks,
  renewJobLease,
  type WorkerQueue,
} from '../services/jobQueueService';

let cycleInProgress = false;
let lastIdempotencyCleanupAt = 0;
const embeddedWorkerId = `embedded-worker:${process.pid}`;

async function processJob(job: {
  kind: string;
  payloadJson: string | null;
}, signal: AbortSignal) {
  signal.throwIfAborted();

  if (job.kind !== 'DELIVER_WEBHOOK') {
    throw new Error(`Unsupported infrastructure job kind: ${job.kind}`);
  }

  const { deliveryId } = parseJobPayload(job.payloadJson);
  if (!deliveryId) {
    throw new Error('Webhook delivery job is missing deliveryId.');
  }

  await deliverWebhookDelivery(deliveryId);
}

async function executeClaimedJob(
  job: Awaited<ReturnType<typeof claimAvailableJobs>>[number],
  workerId: string,
) {
  const startedAt = process.hrtime.bigint();
  let outcome = 'success';
  const abortController = new AbortController();
  const renewalTimer = setInterval(() => {
    void renewJobLease(job.id, workerId, config.jobLeaseMs)
      .then(() => jobLeaseRenewals.inc({ queue: job.queue, outcome: 'success' }))
      .catch((error) => {
        jobLeaseRenewals.inc({ queue: job.queue, outcome: 'failure' });
        abortController.abort(error);
      });
  }, Math.max(1_000, Math.floor(config.jobLeaseMs / 3)));

  try {
    await runWithJobDeadline(config.jobTimeoutMs, async (deadlineSignal) => {
      const abortFromDeadline = () => abortController.abort(deadlineSignal.reason);
      deadlineSignal.addEventListener('abort', abortFromDeadline, { once: true });
      try {
        await processJob(job, abortController.signal);
      } finally {
        deadlineSignal.removeEventListener('abort', abortFromDeadline);
      }
    });
    await completeJob(job.id, workerId);
  } catch (error) {
    outcome = 'failure';
    const message = error instanceof Error ? error.message : 'Unknown job failure';
    const failure = await failJob(job, workerId, message);
    jobRetries.inc({ queue: job.queue, outcome: failure.deadLettered ? 'dead_letter' : 'retry' });
    log('error', 'worker.job.failed', {
      appId: job.appId,
      agreementId: job.agreementId,
      jobId: job.id,
      deliveryId: parseJobPayload(job.payloadJson).deliveryId,
      jobKind: job.kind,
      attempts: job.attempts,
      deadLettered: failure.deadLettered,
      error,
    });
  } finally {
    clearInterval(renewalTimer);
    jobExecutionDuration.observe(
      { queue: job.queue, outcome },
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );
  }
}

export async function runAgentCycle(options: {
  workerId?: string;
  queues?: WorkerQueue[];
  concurrency?: number;
} = {}): Promise<boolean> {
  if (cycleInProgress) {
    return true;
  }

  cycleInProgress = true;
  const workerId = options.workerId ?? embeddedWorkerId;
  const queues = options.queues ?? config.workerQueues as WorkerQueue[];
  const concurrency = options.concurrency ?? config.workerConcurrency;

  try {
    if (Date.now() - lastIdempotencyCleanupAt >= 10 * 60 * 1000) {
      await cleanupExpiredIdempotencyKeys();
      lastIdempotencyCleanupAt = Date.now();
    }
    await releaseStaleLocks(config.jobLeaseMs);
    const jobs = await claimAvailableJobs(workerId, queues, concurrency, config.jobLeaseMs);
    await Promise.all(jobs.map((job) => executeClaimedJob(job, workerId)));
    return true;
  } catch (error) {
    log('error', 'worker.cycle.failed', { workerId, error });
    return false;
  } finally {
    cycleInProgress = false;
  }
}
