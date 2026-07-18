CREATE INDEX "AuditLog_chain_head_idx"
  ON "AuditLog"("createdAt" DESC, "id" DESC)
  WHERE "recordHash" IS NOT NULL;
