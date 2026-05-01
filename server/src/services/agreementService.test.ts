import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRefundConsensusState } from './agreementService';

const clientAddress = 'ckt1-client';
const workerAddress = 'ckt1-worker';

test('buildRefundConsensusState treats a refund proposal as the proposer approval', () => {
  const state = buildRefundConsensusState({
    clientAddress,
    workerAddress,
    events: [
      {
        action: 'REFUND_PROPOSED',
        actorAddress: clientAddress,
        createdAt: '2026-04-30T10:00:00.000Z',
      },
    ],
  });

  assert.equal(state.proposedBy, clientAddress);
  assert.equal(state.clientApprovedAt, '2026-04-30T10:00:00.000Z');
  assert.equal(state.workerApprovedAt, null);
  assert.equal(state.fullyApproved, false);
  assert.equal(state.awaitingAddress, workerAddress);
});

test('buildRefundConsensusState marks the refund fully approved once both parties consent', () => {
  const state = buildRefundConsensusState({
    clientAddress,
    workerAddress,
    events: [
      {
        action: 'REFUND_PROPOSED',
        actorAddress: workerAddress,
        createdAt: '2026-04-30T10:00:00.000Z',
      },
      {
        action: 'REFUND_APPROVED',
        actorAddress: clientAddress,
        createdAt: '2026-04-30T10:05:00.000Z',
      },
    ],
  });

  assert.equal(state.proposedBy, workerAddress);
  assert.equal(state.workerApprovedAt, '2026-04-30T10:00:00.000Z');
  assert.equal(state.clientApprovedAt, '2026-04-30T10:05:00.000Z');
  assert.equal(state.fullyApproved, true);
  assert.equal(state.awaitingAddress, null);
});
