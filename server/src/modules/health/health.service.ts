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
  const [heartbeats, queued, deadLetters, oldest] = await Promise.all([
    prisma.workerHeartbeat.findMany({ orderBy: { lastHeartbeatAt: 'desc' }, take: 50 }),
    prisma.agentJob.count({ where: { status: { in: ['QUEUED', 'RETRY'] } } }),
    prisma.agentJob.count({ where: { status: 'DEAD_LETTER' } }),
    prisma.agentJob.findFirst({
      where: { status: { in: ['QUEUED', 'RETRY'] }, availableAt: { lte: new Date() } },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    }),
  ]);
  const requiredQueues = new Set(config.workerQueues);
  const heartbeat = heartbeats.find((candidate) => {
    const advertised = new Set(candidate.service.split(',').map((queue) => queue.trim()).filter(Boolean));
    return [...requiredQueues].every((queue) => advertised.has(queue));
  });
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

export async function getSettlementStatus(
  required = config.requireSettlementReady,
  nodeUrl = config.ckbNodeUrl,
  indexerUrl = config.ckbIndexerUrl,
) {
  if (!required) {
    return { status: 'not_required' as const };
  }

  try {
    if (!indexerUrl) return { status: 'error' as const };
    const request = (url: string, method: string) => executeProviderRequest({
      provider: 'ckb', operation: 'readiness', timeoutMs: 3_000, maxAttempts: 1, concurrency: 2,
      run: async ({ signal, requestId }) => {
        const result = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId },
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params: [] }), signal,
        });
        assertProviderResponse(result, 'ckb', requestId);
        return result;
      },
    });
    const [nodeResponse, indexerResponse] = await Promise.all([
      request(nodeUrl, 'get_tip_header'),
      request(indexerUrl, 'get_indexer_tip'),
    ]);
    if (!nodeResponse.ok || !indexerResponse.ok) return { status: 'error' as const };
    const [node, indexer] = await Promise.all([
      nodeResponse.json() as Promise<{ result?: unknown; error?: unknown }>,
      indexerResponse.json() as Promise<{ result?: unknown; error?: unknown }>,
    ]);
    return {
      status: node.result && !node.error && indexer.result && !indexer.error ? 'ok' as const : 'error' as const,
    };
  } catch {
    return { status: 'error' as const };
  }
}
