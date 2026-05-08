import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCkboostImportAgreement,
  buildCkboostSourceMetadata,
  isCkboostSource,
  normalizeCampaignHistory,
  normalizeProfileInput,
} from './ckboostIntegrationService';

test('isCkboostSource detects CKBoost metadata and source labels', () => {
  assert.equal(isCkboostSource({ sourceLabel: 'CKBoost', externalMetadataJson: null }), true);
  assert.equal(
    isCkboostSource({
      sourceLabel: 'Imported Grant',
      externalMetadataJson: JSON.stringify({ provider: 'CKBOOST', campaignId: 'camp-1' }),
    }),
    true,
  );
  assert.equal(isCkboostSource({ sourceLabel: 'DAO', externalMetadataJson: null }), false);
});

test('buildCkboostImportAgreement maps campaign and contributor data into a manual PactAgent grant', () => {
  const result = buildCkboostImportAgreement({
    campaign: {
      id: 'camp-1',
      title: 'CKBoost Governance Dashboard',
      url: 'https://ckboost.netlify.app/campaigns/1',
      sponsorName: 'Nervos Grants',
      approvedProofSummary: 'Contributor already shipped the dashboard shell.',
      approvedProofUrl: 'https://ckboost.netlify.app/proof/1',
    },
    contributor: {
      walletAddress: 'ckt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp4u0j8n',
      handle: '@ada',
      contributorExternalId: 'contrib-1',
      profileId: 'profile-1',
    },
    agreement: {
      title: 'Dashboard Delivery Grant',
      description: 'Finalize the dashboard and submit milestone proof.',
      clientAddress: 'ckt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp4u0j8n',
      deadlineAt: '2026-05-07T10:00:00.000Z',
      disputeWindowSecs: 86400,
      proofType: 'URL',
      payoutNetwork: 'CKB',
      milestones: [
        {
          title: 'Milestone 1',
          description: 'Ship the dashboard.',
          amount: '10000000000',
        },
      ],
    },
  });

  assert.equal(result.reviewerMode, 'MANUAL');
  assert.equal(result.releaseMode, 'PARTIAL');
  assert.equal(result.workerAddress, 'ckt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp4u0j8n');
  assert.equal(result.sourceMetadata.sourceLabel, 'CKBoost');
  assert.equal(result.sourceMetadata.sourceReferenceId, 'camp-1');
  assert.equal(result.description.includes('Approved proof summary'), true);
});

test('buildCkboostSourceMetadata preserves provider, sponsor, and sync-back identifiers', () => {
  const metadata = buildCkboostSourceMetadata({
    campaign: {
      id: 'camp-55',
      title: 'Forum Bot Upgrade',
      url: 'https://ckboost.netlify.app/campaigns/55',
      sponsorName: 'Ecosystem DAO',
      governanceThreadUrl: 'https://forum.example.com/t/bot-upgrade/55',
      questBundleTitle: 'Ops Bundle',
      proofExternalId: 'proof-55',
      approvedProofSummary: 'Bot update already reviewed in CKBoost.',
      approvedProofUrl: 'https://ckboost.netlify.app/proof/55',
    },
    contributor: {
      walletAddress: 'ckt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp4u0j8n',
      contributorExternalId: 'contrib-55',
      profileId: 'profile-55',
      profileUrl: 'https://ckboost.netlify.app/profile/55',
    },
    agreement: {
      title: 'Forum Bot Upgrade',
      description: 'Finish the sync bot handoff.',
      clientAddress: 'ckt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp4u0j8n',
      deadlineAt: '2026-05-08T10:00:00.000Z',
      disputeWindowSecs: 86400,
      proofType: 'URL',
      payoutNetwork: 'CKB',
      milestones: [
        {
          title: 'Ship it',
          description: 'Deliver the update.',
          amount: '1000',
        },
      ],
    },
  });

  assert.equal(metadata.provider, 'CKBOOST');
  assert.equal(metadata.campaignId, 'camp-55');
  assert.equal(metadata.sponsorName, 'Ecosystem DAO');
  assert.equal(metadata.proofExternalId, 'proof-55');
  assert.equal(metadata.profileId, 'profile-55');
});

test('normalizeCampaignHistory keeps only non-empty string items', () => {
  const result = normalizeCampaignHistory(['Forum Ops', '', 42, 'Governance Review', '   '] as unknown);

  assert.deepEqual(result, ['Forum Ops', 'Governance Review']);
  assert.equal(normalizeCampaignHistory('not-an-array'), undefined);
});

test('normalizeProfileInput extracts CKBoost contributor snapshot fields safely', () => {
  const result = normalizeProfileInput({
    profileId: 'profile-9',
    contributorExternalId: 'contrib-9',
    walletAddress: 'ckt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp4u0j8n',
    handle: '@builder',
    displayName: 'Builder Nine',
    profileUrl: 'https://ckboost.netlify.app/profile/9',
    campaignParticipationCount: 12,
    approvedSubmissionCount: 10,
    rejectedSubmissionCount: 2,
    approvalRate: 0.83,
    leaderboardRank: 5,
    totalPoints: 440,
    totalTipsReceived: '200000000',
    campaignHistory: ['Grant 1', '', 'Grant 2'],
    stats: {
      approvalsLast30Days: 3,
    },
  });

  assert.equal(result?.profileId, 'profile-9');
  assert.equal(result?.contributorExternalId, 'contrib-9');
  assert.equal(result?.handle, '@builder');
  assert.equal(result?.campaignParticipationCount, 12);
  assert.deepEqual(result?.campaignHistory, ['Grant 1', 'Grant 2']);
  assert.deepEqual(result?.stats, { approvalsLast30Days: 3 });
});

test('normalizeProfileInput returns null for invalid payloads', () => {
  assert.equal(normalizeProfileInput(null), null);
  assert.equal(normalizeProfileInput('bad-payload'), null);
});
