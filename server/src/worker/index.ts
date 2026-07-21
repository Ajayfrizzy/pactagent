import '../common/observability/tracing';
import { config, validateProductionConfig } from '../config';
import { runAgentCycle } from './agentLoop';
import { createLog } from '../services/logService';
import { requireDatabaseUrl } from '../db';
import { prisma } from '../db';
import { beginShutdown, isShuttingDown } from '../common/runtime/lifecycle';
import { installConsoleBridge, log } from '../common/observability/logger';
import { recordWorkerCycle, registerWorker, stopWorker, touchWorker } from '../services/workerHeartbeatService';
import os from 'os';
import { shutdownTracing } from '../common/observability/tracing';
import { createWorkerHealthServer } from './healthServer';
import { assertRequiredMigrationsApplied } from '../common/migrations/migration-readiness';

/**
 * Standalone agent worker process.
 * Runs the agent loop on a configurable interval.
 * Can be started separately: npm run worker
 */
let agentTimer: NodeJS.Timeout | null = null;
let currentCycle: Promise<void> | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
const workerId = config.workerId || `agent:${os.hostname()}`;
const healthServer = createWorkerHealthServer();

async function executeCycle() {
  const startedAt = Date.now();
  try {
    const succeeded = await runAgentCycle({
      workerId,
      queues: config.workerQueues as Array<'settlement' | 'webhook' | 'ai'>,
      concurrency: config.workerConcurrency,
    });
    await recordWorkerCycle(workerId, Date.now() - startedAt, succeeded ? undefined : 'Agent cycle failed.');
  } catch (error) {
    await recordWorkerCycle(workerId, Date.now() - startedAt, error);
    throw error;
  }
}

function scheduleNextCycle() {
  agentTimer = setTimeout(async () => {
    try {
      currentCycle = executeCycle();
      await currentCycle;
    } finally {
      currentCycle = null;
      if (!isShuttingDown()) scheduleNextCycle();
    }
  }, config.agentIntervalMs);
}

async function main() {
  validateProductionConfig();
  requireDatabaseUrl();
  installConsoleBridge();
  await assertRequiredMigrationsApplied();

  const heartbeatService = config.workerQueues.includes('settlement') ? 'agent' : config.workerQueues.join('+');
  await registerWorker(workerId, heartbeatService);
  healthServer.listen(config.workerHealthPort, '0.0.0.0');
  heartbeatTimer = setInterval(() => {
    void touchWorker(workerId).catch((error) => log('error', 'worker.heartbeat.failed', { workerId, error }));
  }, Math.max(1_000, Math.min(config.workerHeartbeatStaleMs / 3, 10_000)));
  log('info', 'worker.started', {
    workerId,
    intervalMs: config.agentIntervalMs,
    healthPort: config.workerHealthPort,
    queues: config.workerQueues,
    concurrency: config.workerConcurrency,
    aiEnabled: config.aiEnabled,
  });

  await createLog({
    level: 'INFO',
    eventType: 'AGREEMENT_CREATED',
    message: 'PactAgent Worker started — observing agreements...',
    metadata: { intervalMs: config.agentIntervalMs },
  });

  // Run first cycle immediately
  currentCycle = executeCycle();
  await currentCycle;
  currentCycle = null;

  // Then run on interval
  scheduleNextCycle();
}

main().catch((err) => {
  log('error', 'worker.fatal', { error: err });
  process.exit(1);
});

let shutdownPromise: Promise<void> | null = null;
function shutdown(signal: string) {
  if (shutdownPromise) return shutdownPromise;
  beginShutdown();
  if (agentTimer) clearTimeout(agentTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  shutdownPromise = (async () => {
    log('info', 'worker.shutdown.started', { signal, workerId });
    if (currentCycle) {
      let drainTimer: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          currentCycle,
          new Promise<never>((_, reject) => {
            drainTimer = setTimeout(() => reject(new Error('Worker drain timeout.')), config.shutdownTimeoutMs);
          }),
        ]);
      } finally {
        if (drainTimer) clearTimeout(drainTimer);
      }
    }
    await new Promise<void>((resolve, reject) => healthServer.close((error) => error ? reject(error) : resolve()));
    await stopWorker(workerId);
    await prisma.$disconnect();
    await shutdownTracing();
    log('info', 'worker.shutdown.completed', { workerId });
  })().catch((error) => {
    log('error', 'worker.shutdown.failed', { workerId, error });
    process.exitCode = 1;
  });
  return shutdownPromise;
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
