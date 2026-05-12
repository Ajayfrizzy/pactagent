import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRefundConsensusState,
  buildSplitConsensusState,
  matchOnchainFundingOutputsToMilestones,
  shouldAutoReleaseCurrentCommencementMilestone,
} from './agreementService';

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

test('buildSplitConsensusState records proposed amounts and awaits worker approval', () => {
  const state = buildSplitConsensusState({
    clientAddress,
    workerAddress,
    milestoneAmount: '1000',
    events: [
      {
        action: 'SPLIT_PROPOSED',
        actorAddress: clientAddress,
        createdAt: '2026-04-30T11:00:00.000Z',
        metadataJson: JSON.stringify({
          workerAmount: '600',
          clientRefundAmount: '400',
        }),
      },
    ],
  });

  assert.equal(state.proposedBy, clientAddress);
  assert.equal(state.workerAmount, '600');
  assert.equal(state.clientRefundAmount, '400');
  assert.equal(state.awaitingAddress, workerAddress);
  assert.equal(state.fullyApproved, false);
});

test('buildSplitConsensusState marks split settlement complete after both approvals', () => {
  const state = buildSplitConsensusState({
    clientAddress,
    workerAddress,
    milestoneAmount: '1000',
    events: [
      {
        action: 'SPLIT_PROPOSED',
        actorAddress: clientAddress,
        createdAt: '2026-04-30T11:00:00.000Z',
        metadataJson: JSON.stringify({
          workerAmount: '700',
          clientRefundAmount: '300',
        }),
      },
      {
        action: 'SPLIT_APPROVED',
        actorAddress: workerAddress,
        createdAt: '2026-04-30T11:05:00.000Z',
        metadataJson: JSON.stringify({
          workerAmount: '700',
          clientRefundAmount: '300',
        }),
      },
    ],
  });

  assert.equal(state.workerAmount, '700');
  assert.equal(state.clientRefundAmount, '300');
  assert.equal(state.fullyApproved, true);
  assert.equal(state.awaitingAddress, null);
});

test('matchOnchainFundingOutputsToMilestones pairs milestones with final on-chain output indices by cell data', () => {
  const matches = matchOnchainFundingOutputsToMilestones(
    [
      { id: 'm1', escrowCellData: '0xaaaa' },
      { id: 'm2', escrowCellData: '0xbbbb' },
    ],
    [
      { index: 4, capacity: BigInt(200), outputData: '0xbbbb' },
      { index: 2, capacity: BigInt(100), outputData: '0xaaaa' },
    ],
  );

  assert.deepEqual(matches, [
    { milestoneId: 'm1', outputIndex: 2, outputData: '0xaaaa' },
    { milestoneId: 'm2', outputIndex: 4, outputData: '0xbbbb' },
  ]);
});

test('shouldAutoReleaseCurrentCommencementMilestone returns true for imported commencement checkpoints', () => {
  const result = shouldAutoReleaseCurrentCommencementMilestone({
    milestones: [
      {
        sortOrder: 1,
        status: 'ACTIVE',
        title: 'Grant Commencement',
        description: 'This imported kickoff release represents the source thread’s upfront commencement payment before the main delivery milestones begin.',
      },
      {
        sortOrder: 2,
        status: 'PENDING',
        title: 'Milestone 1',
        description: 'Normal delivery milestone',
      },
    ],
    source: {
      externalMetadataJson: JSON.stringify({
        parser: 'NERVOS_GRANT_THREAD_V1',
        milestones: [
          { index: 0, title: 'Grant Commencement', kind: 'COMMENCEMENT' },
          { index: 1, title: 'Milestone 1', kind: 'DELIVERABLE' },
        ],
      }),
    },
  });

  assert.equal(result, true);
});

test('shouldAutoReleaseCurrentCommencementMilestone returns false for regular milestones', () => {
  const result = shouldAutoReleaseCurrentCommencementMilestone({
    milestones: [
      {
        sortOrder: 1,
        status: 'ACTIVE',
        title: 'Milestone 1',
        description: 'Normal delivery milestone',
      },
    ],
    source: {
      externalMetadataJson: JSON.stringify({
        parser: 'NERVOS_GRANT_THREAD_V1',
        milestones: [
          { index: 0, title: 'Milestone 1', kind: 'DELIVERABLE' },
        ],
      }),
    },
  });

  assert.equal(result, false);
});
