import { conflict } from '../errors/app-error';
import { lifecycleTransitionConflicts } from '../observability/metrics';

export function assertLifecycleCompareAndSwap(params: {
  resource: 'agreement' | 'milestone' | 'proof' | 'dispute' | 'escrow' | 'transaction';
  affectedRows: number;
  expectedStatus: string;
  nextStatus: string;
}) {
  if (params.affectedRows === 1) return;

  lifecycleTransitionConflicts.inc({ resource: params.resource });
  throw conflict(
    `${params.resource} state changed before the transition from ${params.expectedStatus} to ${params.nextStatus} could be applied.`,
    'lifecycle_conflict',
  );
}
