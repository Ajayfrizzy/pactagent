import os from 'os';
import { prisma } from '../db';
import { config } from '../config';

export function registerWorker(workerId: string) {
  const now = new Date();
  return prisma.workerHeartbeat.upsert({
    where: { id: workerId },
    create: {
      id: workerId,
      hostname: os.hostname(),
      processId: process.pid,
      version: config.buildVersion,
      status: 'running',
      startedAt: now,
      lastHeartbeatAt: now,
    },
    update: {
      hostname: os.hostname(),
      processId: process.pid,
      version: config.buildVersion,
      status: 'running',
      startedAt: now,
      lastHeartbeatAt: now,
      stoppedAt: null,
      lastError: null,
    },
  });
}

export function recordWorkerCycle(workerId: string, durationMs: number, error?: unknown) {
  return prisma.workerHeartbeat.update({
    where: { id: workerId },
    data: {
      status: error ? 'degraded' : 'running',
      lastHeartbeatAt: new Date(),
      lastCycleAt: new Date(),
      lastCycleDurationMs: Math.max(0, Math.round(durationMs)),
      lastError: error instanceof Error ? error.message.slice(0, 1000) : error ? String(error).slice(0, 1000) : null,
      ...(error ? { cyclesFailed: { increment: 1 } } : { cyclesSucceeded: { increment: 1 } }),
    },
  });
}

export function touchWorker(workerId: string) {
  return prisma.workerHeartbeat.updateMany({
    where: { id: workerId, status: { not: 'stopped' } },
    data: { lastHeartbeatAt: new Date() },
  });
}

export function stopWorker(workerId: string) {
  return prisma.workerHeartbeat.updateMany({
    where: { id: workerId },
    data: { status: 'stopped', lastHeartbeatAt: new Date(), stoppedAt: new Date() },
  });
}
