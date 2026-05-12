# PactAgent Devlog

This file is written as a 3-week progress report that can be reused for public updates, weekly reports, or social-platform recap threads.

## 3-Week Summary

Over the last three weeks, PactAgent moved beyond a generic milestone escrow flow and closer to a grant-native workflow for the Nervos ecosystem. The biggest theme across this stretch was reducing manual coordination: source links can now auto-fill structured grant data, imported USD budgets can be converted into live CKB estimates inside the product, and kickoff payments can be handled in a way that matches how real community grants are structured.

Alongside the new backend capabilities, a lot of time also went into UX cleanup. Import flows now start from the source link, dynamic milestones are easier to manage, total lock summaries are more readable, and source warnings are phrased in plain language instead of raw internal field names.

## Week 1

### Focus

Strengthened proof review, reviewer workflows, and the trust layer around milestone approvals.

### UI / UX Updates

- Added clearer proof-review states so reviewers can see whether a submission is checking, missing information, ready for review, or blocked.
- Added reviewer-facing follow-up request flows so missing proof details can be requested in a structured way instead of through off-platform chats.
- Improved agreement detail and dashboard clarity so users can better understand what happens next in the milestone lifecycle.
- Continued polishing status labels, summaries, and role-aware guidance so the interface feels less like raw infrastructure and more like an operational workspace.

### Backend Features Implemented

- Built the AI-assisted proof completeness checker with persisted review records and audit history.
- Added structured info-request records tied directly to milestones so reviewer questions and worker responses are tracked in product.
- Added human confirmation checkpoints to keep AI output advisory and prevent automated approval from bypassing reviewer judgment.
- Enforced stronger policy rules for imported grants so payout approval remains human-controlled.

### Challenges And Resolutions

- Challenge: AI-generated review support could easily become too trusted and accidentally feel like automated approval.
- Resolution: kept the AI layer advisory-only, added explicit human acknowledgment points, and blocked payout approval while important follow-up requests remain open.

- Challenge: Review history was becoming fragmented across proof data, comments, and milestone status changes.
- Resolution: moved toward structured proof-review records and audit events so review actions stay visible and traceable.

## Week 2

### Focus

Turned PactAgent into a much stronger grant-import workspace for the Nervos community.

### UI / UX Updates

- Added a dedicated link-first bounty import experience so operators begin by pasting the forum thread before filling any manual fields.
- Improved the imported source snapshot so budget context, ETA, funding-address availability, and commencement-payment context are visible early.
- Added dynamic milestone handling so imports no longer assume a fixed number of milestones.
- Separated commencement payment from numbered delivery milestones so the grant structure is shown honestly instead of pretending the upfront payment is just Milestone 1.
- Improved agreement detail surfaces so imported source metadata feels like part of the agreement instead of an afterthought.

### Backend Features Implemented

- Built Discourse-aware parsing for Nervos forum threads.
- Added `POST /api/agreements/import-bounty/autofill` to resolve forum-thread data into PactAgent agreement drafts.
- Persisted imported grant snapshots and source attribution metadata on agreements.
- Added source-sync review and publish controls so imported grants can stay connected to their governance thread over time.
- Upgraded the source-sync service to use Discourse topic JSON for better summaries and more reliable syncing.
- Tightened background sync cadence so imported agreements refresh more frequently.

### Challenges And Resolutions

- Challenge: Forum posts are not structured like APIs, and the wording is inconsistent from one grant thread to another.
- Resolution: used Discourse-aware parsing, defensive field extraction, and imported-source metadata snapshots so PactAgent can still produce stable drafts even when the source format varies.

- Challenge: Some source threads omit important fields like a funding wallet address, which made the UI look like it was failing.
- Resolution: converted raw field-name warnings into human-readable messages such as “The original forum thread did not include a funding wallet address.”

- Challenge: Real grant threads often include a separate upfront payment that does not belong inside the standard milestone sequence.
- Resolution: modeled that payment as its own commencement checkpoint instead of flattening it into the first delivery milestone.

## Week 3

### Focus

Expanded imported-grant automation with CKBoost handoff, live pricing, and payout behavior that matches real grant operations.

### UI / UX Updates

- Added CKBoost campaign-link auto-fill so campaign metadata and quest-derived milestone drafts can be populated from a pasted link.
- Added live CKB quote panels to the bounty import flow so imported USD budgets can be translated into current CKB estimates.
- Added editable USD/CKB helper inputs and a single `Refresh All CKB Estimates` action to make price recalculation easier without cluttering each row.
- Fixed large total-lock figures so they format and wrap cleanly instead of overflowing milestone funding cards.
- Updated grant milestone labeling so commencement payments display as `Commencement Payment` while real delivery milestones keep numbered labels.
- Moved key import actions and summaries higher in the page flow for better operator onboarding.

### Backend Features Implemented

- Built a CKBoost campaign resolver and auto-fill route for campaign-link imports.
- Added stored CKBoost contributor snapshots, event history, webhook ingestion, and outbound lifecycle notifications.
- Built the live CKB/USD quote service and connected it to imported grant conversion flows.
- Added automatic CKB prefill for imported milestone USD amounts when a live quote is available.
- Added automatic commencement-payment release after funding confirmation when the imported source marks a dedicated kickoff checkpoint.

### Challenges And Resolutions

- Challenge: CKBoost pages are client-rendered, which makes naive HTML scraping unreliable.
- Resolution: built a proper resolver around the underlying campaign data source instead of depending on brittle page scraping alone.

- Challenge: The CoinGecko live-price request was failing because the request builder dropped the `/api/v3` path and hit the wrong endpoint.
- Resolution: fixed the market-price URL construction so live quotes resolve correctly and the bounty import UI can recover.

- Challenge: Editing imported amount references did not always update the total lock summary clearly enough.
- Resolution: recalculated CKB amounts immediately from USD edits, refreshed total-lock summaries live, and improved numeric formatting so changes are visible.

## Key Product Outcomes Across The 3 Weeks

- Reduced manual data entry for both Nervos forum grants and CKBoost campaign imports.
- Made imported grants behave more like real ecosystem grants instead of forcing them into a generic milestone template.
- Kept AI assistance useful while preserving human control over approvals and payouts.
- Improved operator confidence through clearer import flows, better labeling, and more transparent agreement-state communication.
- Brought PactAgent closer to a production-ready community-grant workflow for the Nervos ecosystem.

## Reusable Public Summary

Over the last three weeks, PactAgent evolved from a milestone escrow tool into a much stronger grant-operations workspace for Nervos. I shipped forum-thread auto-fill, dynamic milestone extraction, source sync, CKBoost campaign import, live CKB pricing for USD-denominated grants, and automatic handling for separate commencement payments. I also spent a lot of time on UX cleanup so imported grants feel intentional, readable, and easier to operate for real community workflows.
