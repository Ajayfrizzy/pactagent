import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgreementSchema } from './agreement.validation';

const agreement = {
  title: 'Example agreement',
  clientExternalId: 'client',
  workerExternalId: 'worker',
  totalAmount: '100',
};

test('agreement metadata accepts arbitrary keys and nested JSON values', () => {
  const metadata = { reference: 'order-1', count: 2, details: { tags: ['work'], active: true }, optional: null };
  assert.deepEqual(createAgreementSchema.parse({ ...agreement, metadata }).metadata, metadata);
  assert.deepEqual(createAgreementSchema.parse(agreement).metadata, {});
});

test('agreement metadata rejects arrays and payloads exceeding the byte limit', () => {
  assert.equal(createAgreementSchema.safeParse({ ...agreement, metadata: [] }).success, false);
  assert.equal(createAgreementSchema.safeParse({ ...agreement, metadata: { text: 'é'.repeat(8192) } }).success, false);
});
