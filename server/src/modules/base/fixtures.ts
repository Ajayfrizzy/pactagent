import type { Terms } from './codec';
export const wordId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
export const localTerms = (): Terms => ({ appId: wordId(1), agreementId: wordId(2), milestoneId: wordId(3), escrowId: wordId(4), applicationCommitment: wordId(5),
  token: '0x0000000000000000000000000000000000000111', client: '0x0000000000000000000000000000000000000022',
  worker: '0x0000000000000000000000000000000000000033', treasury: '0x0000000000000000000000000000000000000044',
  principal: '1000001', clientBps: '1000', workerBps: '333', feePolicy: wordId(6), fallbackWorker: '370001',
  disputeDeadline: '200', finalDeadline: '300', threshold: '2', intervalPolicy: '1', minDisputeInterval: '30',
  arbiters: ['0x0000000000000000000000000000000000000055', '0x0000000000000000000000000000000000000066'] });
