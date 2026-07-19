-- Indexes match the worker scheduler's measured filters and ordering. Validate
-- with EXPLAIN (ANALYZE, BUFFERS) in staging before changing this set.
CREATE INDEX "Agreement_status_updatedAt_id_idx"
  ON "Agreement"("status", "updatedAt", "id");
CREATE INDEX "Agreement_settlementStatus_updatedAt_id_idx"
  ON "Agreement"("settlementStatus", "updatedAt", "id");
CREATE INDEX "Agreement_status_deadlineAt_id_idx"
  ON "Agreement"("status", "deadlineAt", "id");
