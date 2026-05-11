import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCampaignIdFromInput } from './ckboostCampaignResolverService';

test('extractCampaignIdFromInput accepts raw CKBoost campaign ids', () => {
  const id = extractCampaignIdFromInput('0x775802a38a6d67ab1351ae5d676adeb6e72e041d39c041dff4e901d0ae27f0bc');
  assert.equal(id, '0x775802a38a6d67ab1351ae5d676adeb6e72e041d39c041dff4e901d0ae27f0bc');
});

test('extractCampaignIdFromInput extracts the campaign id from CKBoost campaign links', () => {
  const id = extractCampaignIdFromInput(
    'https://ckboost.netlify.app/campaign/0x6d5b52081ff0717cff7601409fcdcc1ffba9038afa1e0f9d3da4b5f2a8178bbe',
  );

  assert.equal(id, '0x6d5b52081ff0717cff7601409fcdcc1ffba9038afa1e0f9d3da4b5f2a8178bbe');
});

test('extractCampaignIdFromInput rejects invalid links and malformed ids', () => {
  assert.throws(
    () => extractCampaignIdFromInput('https://ckboost.netlify.app/campaign/not-a-real-id'),
    /CKBoost campaign ID/,
  );
  assert.throws(
    () => extractCampaignIdFromInput(''),
    /campaign link or campaign ID/,
  );
});
