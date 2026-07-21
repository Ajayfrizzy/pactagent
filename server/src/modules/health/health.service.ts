import { dbPool, prisma } from '../../db';
import { config } from '../../config';
import { isShuttingDown } from '../../common/runtime/lifecycle';
import { dbPoolConnections, dbPoolSaturation, deadLetterJobs, oldestQueuedJobAge, queuedJobs, workerCycles, workerHeartbeatAge } from '../../common/observability/metrics';
import { assertProviderResponse, executeProviderRequest } from '../../common/resilience/provider';

function getDatabasePoolStatus() {
  dbPoolConnections.set({ state: 'total' }, dbPool.totalCount);
  dbPoolConnections.set({ state: 'idle' }, dbPool.idleCount);
  dbPoolConnections.set({ state: 'waiting' }, dbPool.waitingCount);
  dbPoolSaturation.set(Math.min(1, (dbPool.totalCount - dbPool.idleCount + dbPool.waitingCount) / config.dbPoolMax));
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
    const [operations, settlement] = await Promise.all([
      getWorkerAndQueueStatus(),
      getSettlementStatus(),
    ]);
    const ready = !isShuttingDown()
      && (!config.requireWorkerReady || operations.status === 'ok')
      && (!config.requireSettlementReady || settlement.status === 'ok');
    return {
      status: ready ? 'ready' : 'not_ready',
      database: 'ok',
      databasePool: getDatabasePoolStatus(),
      worker: operations,
      settlement,
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

export async function getSettlementStatus(required = config.requireSettlementReady, nodeUrl = config.ckbNodeUrl) {
  if (!required) {
    return { status: 'not_required' as const };
  }

  try {
    const response = await executeProviderRequest({
      provider: 'ckb', operation: 'readiness', timeoutMs: 3_000, maxAttempts: 1, concurrency: 2,
      run: async ({ signal, requestId }) => {
        const result = await fetch(nodeUrl, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId },
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'get_tip_header', params: [] }), signal,
        });
        assertProviderResponse(result, 'ckb', requestId);
        return result;
      },
    });
    if (!response.ok) return { status: 'error' as const };
    const result = await response.json() as { result?: unknown; error?: unknown };
    return { status: result.result && !result.error ? 'ok' as const : 'error' as const };
  } catch {
    return { status: 'error' as const };
  }
}
