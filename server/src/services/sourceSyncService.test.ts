import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_SYNC_STATUSES, parseDiscourseTopicTarget, summarizeSourceThreadHtml } from './sourceSyncService';

test('summarizeSourceThreadHtml extracts the title, description, and body excerpt', () => {
  const summary = summarizeSourceThreadHtml(
    'https://forum.example.com/t/grant-42',
    `
      <html>
        <head>
          <title>Grant 42 Weekly Update</title>
          <meta name="description" content="Milestone 2 is under review and screenshots are attached." />
        </head>
        <body>
          <article>
            <p>The contributor posted a deployment link, screenshots, and a governance follow-up note for reviewers.</p>
          </article>
        </body>
      </html>
    `
  );

  assert.equal(summary.includes('Grant 42 Weekly Update'), true);
  assert.equal(summary.includes('Milestone 2 is under review'), true);
  assert.equal(summary.includes('deployment link, screenshots'), true);
});

test('parseDiscourseTopicTarget extracts a topic id from a discourse thread URL', () => {
  const target = parseDiscourseTopicTarget('https://forum.example.com/t/grant-42-weekly-update/123/4');

  assert.equal(target?.apiBaseUrl, 'https://forum.example.com');
  assert.equal(target?.topicId, 123);
  assert.equal(target?.topicUrl, 'https://forum.example.com/t/grant-42-weekly-update/123/4');
});

test('parseDiscourseTopicTarget supports bare discourse topic id paths', () => {
  const target = parseDiscourseTopicTarget('https://forum.example.com/t/123');

  assert.equal(target?.apiBaseUrl, 'https://forum.example.com');
  assert.equal(target?.topicId, 123);
});

test('parseDiscourseTopicTarget returns null for unsupported thread urls', () => {
  const target = parseDiscourseTopicTarget('https://forum.example.com/c/governance/5');

  assert.equal(target, null);
});

test('source sync statuses include the full review and publish lifecycle', () => {
  assert.deepEqual(SOURCE_SYNC_STATUSES, [
    'READY_TO_SYNC',
    'SYNCED',
    'DRAFTED',
    'REVIEWED',
    'PUBLISHED',
    'FAILED',
    'NOT_CONFIGURED',
  ]);
});
