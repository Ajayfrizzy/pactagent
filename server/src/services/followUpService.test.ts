import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFollowUpDraft, parseInfoRequestRecords } from './followUpService';

test('generateFollowUpDraft turns proof check gaps into targeted reviewer questions', () => {
  const draft = generateFollowUpDraft({
    milestoneId: 'milestone-1',
    milestoneTitle: 'Frontend landing page',
    proofCheck: {
      agreementId: 'agreement-1',
      milestoneId: 'milestone-1',
      proofId: 'proof-1',
      checkedAt: '2026-05-06T10:00:00.000Z',
      status: 'NEEDS_MORE_INFO',
      lifecycleStatus: 'ISSUES_FOUND',
      summary: 'Needs more information.',
      issueCount: 2,
      warningCount: 0,
      warnings: [],
      checklist: [
        {
          key: 'links',
          label: 'Links present',
          status: 'MISSING',
          detail: 'No links found.',
          warning: 'Add a link.',
        },
        {
          key: 'scope',
          label: 'Milestone scope matched',
          status: 'PARTIAL',
          detail: 'Weak scope match.',
          warning: 'Add scope detail.',
        },
      ],
    },
  });

  assert.equal(draft.prompts.length, 2);
  assert.equal(draft.prompts[0].includes('direct links'), true);
  assert.equal(draft.prompts[1].includes('maps to the agreed milestone scope'), true);
});

test('parseInfoRequestRecords marks requests resolved when a matching response arrives', () => {
  const records = parseInfoRequestRecords([
    {
      action: 'INFO_REQUESTED',
      actorAddress: 'ckt1-client',
      metadataJson: JSON.stringify({
        requestId: 'req_1234',
        milestoneId: 'milestone-1',
        questions: ['Can you share the repo link?'],
      }),
      createdAt: '2026-05-06T10:00:00.000Z',
    },
    {
      action: 'INFO_RECEIVED',
      actorAddress: 'ckt1-worker',
      metadataJson: JSON.stringify({
        requestId: 'req_1234',
        milestoneId: 'milestone-1',
        responsePreview: 'Repo link is now attached.',
      }),
      createdAt: '2026-05-06T10:15:00.000Z',
    },
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].resolved, true);
  assert.equal(records[0].responseBy, 'ckt1-worker');
});
