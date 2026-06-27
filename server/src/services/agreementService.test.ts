import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getImportedCommencementDetails,
  buildRefundConsensusState,
  buildSplitConsensusState,
  getBlockingDisputeSettlementProposal,
  getAllowedDisputeResolutionChoices,
  matchOnchainFundingOutputsToMilestones,
  isSponsorControlledImportedAgreement,
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

test('getBlockingDisputeSettlementProposal blocks unresolved split but not completed split', () => {
  const pendingSplit = getBlockingDisputeSettlementProposal({
    dispute: {
      id: 'dispute-1',
      splitConsensus: {
        proposedBy: clientAddress,
        proposedAt: '2026-04-30T11:00:00.000Z',
        clientApprovedAt: '2026-04-30T11:00:00.000Z',
        workerApprovedAt: null,
        workerAmount: '700',
        clientRefundAmount: '300',
        fullyApproved: false,
        awaitingAddress: workerAddress,
      },
    },
  });

  assert.equal(pendingSplit?.type, 'SPLIT');
  assert.equal(pendingSplit?.awaitingAddress, workerAddress);

  const completedSplit = getBlockingDisputeSettlementProposal({
    dispute: {
      id: 'dispute-2',
      splitConsensus: {
        proposedBy: clientAddress,
        proposedAt: '2026-04-30T11:00:00.000Z',
        clientApprovedAt: '2026-04-30T11:00:00.000Z',
        workerApprovedAt: '2026-04-30T11:05:00.000Z',
        workerAmount: '700',
        clientRefundAmount: '300',
        fullyApproved: true,
        awaitingAddress: null,
      },
    },
  });

  assert.equal(completedSplit, null);
});

test('getBlockingDisputeSettlementProposal blocks unresolved mutual refund proposal', () => {
  const pendingRefund = getBlockingDisputeSettlementProposal({
    dispute: {
      id: 'dispute-3',
      refundConsensus: {
        proposedBy: clientAddress,
        proposedAt: '2026-04-30T12:00:00.000Z',
        clientApprovedAt: '2026-04-30T12:00:00.000Z',
        workerApprovedAt: null,
        fullyApproved: false,
        awaitingAddress: workerAddress,
      },
    },
  });

  assert.equal(pendingRefund?.type, 'REFUND');
  assert.equal(pendingRefund?.awaitingAddress, workerAddress);
});

test('getAllowedDisputeResolutionChoices separates client and worker dispute outcomes', () => {
  assert.deepEqual(
    getAllowedDisputeResolutionChoices({
      actorAddress: clientAddress,
      clientAddress,
      workerAddress,
    }),
    ['REFUND', 'SPLIT'],
  );

  assert.deepEqual(
    getAllowedDisputeResolutionChoices({
      actorAddress: workerAddress,
      clientAddress,
      workerAddress,
    }),
    ['PAYOUT', 'SPLIT'],
  );

  assert.deepEqual(
    getAllowedDisputeResolutionChoices({
      actorAddress: 'ckt1-observer',
      clientAddress,
      workerAddress,
    }),
    [],
  );
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

test('getImportedCommencementDetails returns imported commencement metadata when present', () => {
  const result = getImportedCommencementDetails({
    source: {
      externalMetadataJson: JSON.stringify({
        parser: 'NERVOS_GRANT_THREAD_V1',
        upfrontPayment: {
          amountUsd: '$1,500',
          percentage: '10%',
          label: 'Grant Commencement (10%)',
          amountShannons: '12300000000',
        },
        milestones: [
          { index: 0, title: 'Grant Commencement', kind: 'COMMENCEMENT' },
          { index: 1, title: 'Milestone 1', kind: 'DELIVERABLE' },
        ],
      }),
    },
  });

  assert.deepEqual(result, {
    title: 'Grant Commencement',
    amountUsd: '$1,500',
    percentage: '10%',
    label: 'Grant Commencement (10%)',
    amountShannons: '12300000000',
  });
});

test('getImportedCommencementDetails returns null for regular imported milestones', () => {
  const result = getImportedCommencementDetails({
    source: {
      externalMetadataJson: JSON.stringify({
        parser: 'NERVOS_GRANT_THREAD_V1',
        milestones: [
          { index: 0, title: 'Milestone 1', kind: 'DELIVERABLE' },
        ],
      }),
    },
  });

  assert.equal(result, null);
});

test('isSponsorControlledImportedAgreement only matches DAO and BOUNTY imports', () => {
  assert.equal(isSponsorControlledImportedAgreement({ source: { sourceType: 'DAO' } }), true);
  assert.equal(isSponsorControlledImportedAgreement({ source: { sourceType: 'BOUNTY' } }), true);
  assert.equal(isSponsorControlledImportedAgreement({ source: { sourceType: 'CKBOOST' } }), false);
  assert.equal(isSponsorControlledImportedAgreement({ source: null }), false);
});
