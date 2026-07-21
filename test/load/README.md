# Load tests

Install k6, start a disposable local or staging stack, then set `BASE_URL` and, for authenticated profiles, `API_KEY`. The scripts define conservative defaults and fail on elevated error rates or latency. Never point write-heavy profiles at production without an approved traffic window.

`npm run load:api` measures liveness throughput. `npm run load:queue` creates agreements to exercise API and queue throughput. `npm run load:webhooks` measures webhook delivery-list throughput.

The staging release workflow runs all three profiles after readiness and smoke checks. Any k6 threshold failure stops promotion and triggers the application rollback step. The queue profile repeats each concurrent mutation with the same idempotency key and requires the same agreement ID, so throughput cannot pass by sacrificing replay correctness.
