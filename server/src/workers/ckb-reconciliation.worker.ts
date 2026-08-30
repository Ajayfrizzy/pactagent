import { ckbReconciliationBacklog, ckbStaleTransactions } from '../common/observability/metrics';
import { config } from '../config';
import { prisma } from '../db';
import { reconcileCkbTransaction } from '../modules/escrows/escrow.service';

const RECONCILIATION_STATUSES = [
  'pending',
  'broadcast',
  'committed',
  'reconciliation_required',
  'reorged',
];

export async function runCkbReconciliationWorker(transactionId: string) {
  return reconcileCkbTransaction(transactionId);
}

export async function refreshCkbReconciliationMetrics() {
  const staleBefore = new Date(Date.now() - config.ckbStaleTransactionMs);
  const monitoringDepth = config.ckbConfirmations + 20;
  const [rows, staleRows, confirmedMonitoring, staleConfirmedMonitoring] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['status'],
      where: { rail: 'ckb', status: { in: RECONCILIATION_STATUSES } },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ['status'],
      where: {
        rail: 'ckb',
        status: { in: RECONCILIATION_STATUSES },
        OR: [
          { lastCheckedAt: { lt: staleBefore } },
          { lastCheckedAt: null, createdAt: { lt: staleBefore } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.transaction.count({
      where: { rail: 'ckb', status: 'confirmed', confirmations: { lt: monitoringDepth } },
    }),
    prisma.transaction.count({
      where: {
        rail: 'ckb',
        status: 'confirmed',
        confirmations: { lt: monitoringDepth },
        OR: [
          { lastCheckedAt: { lt: staleBefore } },
          { lastCheckedAt: null, createdAt: { lt: staleBefore } },
        ],
      },
    }),
  ]);
  for (const status of RECONCILIATION_STATUSES) {
    ckbReconciliationBacklog.set(
      { status },
      rows.find((row) => row.status === status)?._count._all ?? 0,
    );
    ckbStaleTransactions.set(
      { status },
      staleRows.find((row) => row.status === status)?._count._all ?? 0,
    );
  }
  ckbReconciliationBacklog.set({ status: 'confirmed_monitoring' }, confirmedMonitoring);
  ckbStaleTransactions.set({ status: 'confirmed_monitoring' }, staleConfirmedMonitoring);
}
