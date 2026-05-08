import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProofCompleteness } from './reportReviewService';
import { serializeProofBundle } from './richPayloadService';

test('evaluateProofCompleteness marks a proof as ready when links, tx hash, screenshots, and scope all line up', () => {
  const result = evaluateProofCompleteness({
    agreementId: 'agreement-1',
    milestoneId: 'milestone-1',
    proofId: 'proof-1',
    milestoneTitle: 'Frontend landing page and CKB deployment',
    milestoneDescription: 'Deliver the frontend landing page, screenshots, and deployment transaction hash.',
    proofContent: serializeProofBundle({
      summary: 'Landing page deployed to testnet with screenshots attached.',
      primaryText: 'Deployed landing page update. Transaction hash: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      revision: 1,
      artifacts: [
        {
          kind: 'URL',
          label: 'Preview',
          content: 'https://example.com/demo',
        },
        {
          kind: 'IMAGE',
          label: 'Screenshot',
          content: 'data:image/png;base64,abc123',
          mimeType: 'image/png',
        },
      ],
    }),
  });

  assert.equal(result.status, 'READY_FOR_HUMAN_REVIEW');
  assert.equal(result.lifecycleStatus, 'READY_FOR_HUMAN_REVIEW');
  assert.equal(result.issueCount, 0);
  assert.equal(result.warningCount, 0);
  assert.equal(result.checklist.every((item) => ['PRESENT', 'NOT_APPLICABLE'].includes(item.status)), true);
});

test('evaluateProofCompleteness asks for more info when basic evidence is missing', () => {
  const result = evaluateProofCompleteness({
    agreementId: 'agreement-2',
    milestoneId: 'milestone-2',
    proofId: 'proof-2',
    milestoneTitle: 'Frontend landing page and CKB deployment',
    milestoneDescription: 'Deliver the frontend landing page, screenshots, and deployment transaction hash.',
    proofContent: serializeProofBundle({
      summary: 'Work is finished.',
      primaryText: 'Please review.',
      revision: 1,
      artifacts: [],
    }),
  });

  assert.equal(result.status, 'NEEDS_MORE_INFO');
  assert.equal(result.lifecycleStatus, 'ISSUES_FOUND');
  assert.equal(result.issueCount >= 2, true);
  assert.equal(result.warnings.length >= 2, true);
});
