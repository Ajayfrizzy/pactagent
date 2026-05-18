import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNervosGrantAutofillFromTopic,
} from './nervosGrantResolverService';

const sampleTopic = {
  id: 9879,
  title: '[DIS] Mobile-Ready CKB Light Client (Pocket Node) for Android',
  posts_count: 40,
  last_posted_at: '2026-05-11T07:22:31.369Z',
  tags: ['CKB', 'light-client'],
  post_stream: {
    posts: [
      {
        id: 22365,
        username: 'Jnr6',
        created_at: '2026-01-27T09:25:32.024Z',
        cooked: `
          <h2><strong>Link to VOT page:</strong> <a href="https://dao.ckb.community/landing?method=share&amp;thread=67494&amp;refer_id=51416">https://dao.ckb.community/landing?method=share&amp;thread=67494&amp;refer_id=51416</a></h2>
          <h2><strong>1. Summary</strong></h2>
          <p>This proposal requests a grant to complete and launch <strong>Pocket Node</strong>, a mobile-first light wallet for Nervos CKB that enables users to securely manage CKB directly from their Android devices.</p>
          <p><strong>Grant Amount Requested:</strong> $15,000 USD (payable in CKB)<br />
          <strong>ETA to Completion:</strong> 4 months after approval<br />
          <strong>CKB Wallet / Funding Address:</strong> <em>To be provided</em></p>
          <h2><strong>2. Project Introduction</strong></h2>
          <p>The Nervos CKB ecosystem currently lacks a mobile wallet solution that combines true self-custody and embedded light-client verification.</p>
          <h2><strong>3. Team &amp; Roles</strong></h2>
          <p>Jr (@Jnr6)</p>
          <h2><strong>4. Current Status</strong></h2>
          <p>Research completed. Prototype implemented. Feedback received from early testers in the CKB community.</p>
          <h2><strong>5. Application Design</strong></h2>
          <p>Functional overview, architecture, design rationale, and sustainability planning.</p>
          <h2><strong>6. Key Benefits for CKB</strong></h2>
          <p>Mobile decentralization, developer enablement, ecosystem growth, and true self-custody.</p>
          <h2><strong>7. Detailed Deliverables &amp; Milestones.</strong></h2>
          <p>The funding covers 4 months of focused delivery across four clear phases. An initial 10% down payment is received at the commencement of the grant.</p>
          <p><strong>Milestone 1: Mainnet Ready &amp; Hardware-Backed Security (Month 1) — 22.5% of grant</strong><br />
          Production configuration, BIP39 secured by TEE, biometric fallback, verification testing.</p>
          <p><strong>Milestone 2: Nervos DAO Protocol Integration (Month 2) — 22.5% of grant</strong><br />
          DAO transaction builder, lifecycle management, economics, visualization.</p>
          <p><strong>Milestone 3: Multi-Wallet and Sync Optimization (Month 3) - 22.5% of grant</strong><br />
          Secure storage, SQLite tuning, analytics, stress testing.</p>
          <p><strong>Milestone 4: Address Book, Polish &amp; Launch (Month 4) - 22.5% of grant</strong><br />
          Security review, identity contacts, app store polish, community launch.</p>
          <p><strong>Post-Grant Maintenance Schedule</strong><br />
          Stabilization period and bug-fix support.</p>
          <h2><strong>8. Budget Breakdown.</strong></h2>
          <p>Total Request: $15,000 USD (payable in CKB)</p>
          <p>Milestone<br />Amount<br />
          Grant Commencement (10%)<br />$1,500<br />
          Milestone 1: Mainnet &amp; Security<br />$3,375<br />
          Milestone 2: Nervos DAO Integration<br />$3,375<br />
          Milestone 3: Multi-Wallet and Sync Optimization<br />$3,375<br />
          Milestone 4: Address Book, Polish &amp; Launch<br />$3,375<br />
          Total<br />$15,000</p>
          <h2><strong>10. Out-of-Scope / Future Funding Needs.</strong></h2>
          <p>iOS version and future major features require separate funding.</p>
          <h2><strong>11. Risk &amp; Mitigation</strong></h2>
          <p>Technical complexity and adoption risks are mitigated through phased delivery and ongoing testing.</p>
        `,
      },
    ],
  },
};

test('buildNervosGrantAutofillFromTopic extracts source fields, commencement payment, and milestones', () => {
  const result = buildNervosGrantAutofillFromTopic(
    'https://talk.nervos.org/t/dis-mobile-ready-ckb-light-client-pocket-node-for-android/9879',
    sampleTopic,
  );

  assert.equal(result.sourceType, 'DAO');
  assert.equal(result.sourceLabel, 'CKB Community Fund DAO');
  assert.equal(result.bountyTitle, 'Mobile-Ready CKB Light Client (Pocket Node) for Android');
  assert.equal(result.sourceReferenceId, '9879');
  assert.equal(result.sponsorName, 'CKB Community Fund DAO');
  assert.equal(result.deadlineDays, '120');
  assert.equal(result.milestones.length, 4);
  assert.equal(result.milestones[0]?.kind, 'DELIVERABLE');
  assert.equal(result.milestones[0]?.title, 'Mainnet Ready & Hardware-Backed Security');
  assert.equal(result.milestones[0]?.sourceBudgetLabel, '$3,375 · 22.5%');
  assert.equal(result.sourceMetadata.upfrontPayment.percentage, '10%');
  assert.equal(result.sourceMetadata.upfrontPayment.amountUsd, '$1,500');
  assert.equal(result.sourceMetadata.upfrontPayment.amountShannons, null);
  assert.equal(result.sourceMetadata.fundingAddress, null);
  assert.equal(result.sourceMetadata.missingFields.includes('fundingAddress'), true);
});
