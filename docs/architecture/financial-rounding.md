# Financial representation and rounding

CKB settlement amounts are integer shannon strings. The supported range is `1` through `18446744073709551615` (unsigned 64-bit). Application validation and PostgreSQL constraints reject zero, negative, fractional, malformed, and out-of-range settlement amounts.

USD targets and CKB/USD quotes use `DECIMAL(30,12)` in PostgreSQL and `Prisma.Decimal` during conversion. Settlement code must not use JavaScript arithmetic operators on monetary values. To convert a USD obligation to shannons:

1. Divide the USD amount by the USD-per-CKB quote using decimal arithmetic.
2. Multiply by `100000000` shannons per CKB.
3. Round toward positive infinity to the next whole shannon.
4. Reject a result outside the supported uint64 range.

Rounding upward prevents an agreed USD obligation from being underfunded. UI-only CKB amount formatting uses at most eight decimal places and the same upward rounding rule when it can affect funding.

Every persisted conversion records the price provider and quote timestamp. CoinGecko quotes use the provider's `last_updated_at` when available and otherwise use the fetch timestamp. Historical rows migrated without provenance use `legacy_unknown`; they must not be presented as contemporaneous market quotes.

Split settlements use integer arithmetic. `workerAmount + clientAmount` must equal the funded escrow amount exactly. Either share may be zero, but neither may be negative or exceed the scope. No tolerance or floating-point comparison is permitted.
