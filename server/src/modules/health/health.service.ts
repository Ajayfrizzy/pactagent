import { dbPool, prisma } from '../../db';
import { config } from '../../config';
import { isShuttingDown } from '../../common/runtime/lifecycle';
import { dbPoolConnections, deadLetterJobs, oldestQueuedJobAge, queuedJobs, workerCycles, workerHeartbeatAge } from '../../common/observability/metrics';

function getDatabasePoolStatus() {
  dbPoolConnections.set({ state: 'total' }, dbPool.totalCount);
  dbPoolConnections.set({ state: 'idle' }, dbPool.idleCount);
  dbPoolConnections.set({ state: 'waiting' }, dbPool.waitingCount);
  return { total: dbPool.totalCount, idle: dbPool.idleCount, waiting: dbPool.waitingCount, max: config.dbPoolMax };
}

export function getHealthStatus() {
  return {
    status: isShuttingDown() ? 'shutting_down' : 'ok',
    version: config.buildVersion,
    commit: config.buildCommit,
    timestamp: new Date().toISOString(),
  };
}

export async function getWorkerAndQueueStatus() {
  const now = Date.now();
  const [heartbeat, queued, deadLetters, oldest] = await Promise.all([
    prisma.workerHeartbeat.findFirst({ where: { service: 'agent' }, orderBy: { lastHeartbeatAt: 'desc' } }),
    prisma.agentJob.count({ where: { status: { in: ['QUEUED', 'RETRY'] } } }),
    prisma.agentJob.count({ where: { status: 'DEAD_LETTER' } }),
    prisma.agentJob.findFirst({
      where: { status: { in: ['QUEUED', 'RETRY'] }, availableAt: { lte: new Date() } },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    }),
  ]);
  const heartbeatAgeMs = heartbeat ? Math.max(0, now - heartbeat.lastHeartbeatAt.getTime()) : null;
  const oldestAgeMs = oldest ? Math.max(0, now - oldest.availableAt.getTime()) : 0;
  queuedJobs.set(queued);
  deadLetterJobs.set(deadLetters);
  oldestQueuedJobAge.set(oldestAgeMs / 1000);
  workerHeartbeatAge.set((heartbeatAgeMs ?? config.workerHeartbeatStaleMs * 2) / 1000);
  workerCycles.set({ outcome: 'success' }, heartbeat?.cyclesSucceeded ?? 0);
  workerCycles.set({ outcome: 'error' }, heartbeat?.cyclesFailed ?? 0);
  return {
    status: heartbeat && heartbeat.status !== 'stopped' && heartbeatAgeMs !== null && heartbeatAgeMs <= config.workerHeartbeatStaleMs
      ? 'ok' : 'stale',
    workerId: heartbeat?.id ?? null,
    heartbeatAgeMs,
    lastCycleAt: heartbeat?.lastCycleAt?.toISOString() ?? null,
    lastCycleDurationMs: heartbeat?.lastCycleDurationMs ?? null,
    cyclesSucceeded: heartbeat?.cyclesSucceeded ?? 0,
    cyclesFailed: heartbeat?.cyclesFailed ?? 0,
    queuedJobs: queued,
    deadLetterJobs: deadLetters,
    oldestQueuedJobAgeMs: oldestAgeMs,
  };
}

export async function getReadinessStatus() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const operations = await getWorkerAndQueueStatus();
    const ready = !isShuttingDown() && (!config.requireWorkerReady || operations.status === 'ok');
    return {
      status: ready ? 'ready' : 'not_ready',
      database: 'ok',
      databasePool: getDatabasePoolStatus(),
      worker: operations,
      version: config.buildVersion,
      commit: config.buildCommit,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      status: 'not_ready',
      database: 'error',
      timestamp: new Date().toISOString(),
    };
  }
}
