-- Preserve existing values while replacing binary floating point with fixed precision.
ALTER TABLE "Agreement"
  ALTER COLUMN "reserveFundingQuoteUsdPerCkb" TYPE DECIMAL(30,12)
  USING "reserveFundingQuoteUsdPerCkb"::DECIMAL(30,12);

ALTER TABLE "Milestone"
  ALTER COLUMN "targetUsd" TYPE DECIMAL(30,12) USING "targetUsd"::DECIMAL(30,12),
  ALTER COLUMN "releaseQuoteUsdPerCkb" TYPE DECIMAL(30,12) USING "releaseQuoteUsdPerCkb"::DECIMAL(30,12),
  ALTER COLUMN "releasedUsdValue" TYPE DECIMAL(30,12) USING "releasedUsdValue"::DECIMAL(30,12);

CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "service" TEXT NOT NULL DEFAULT 'agent',
  "status" TEXT NOT NULL DEFAULT 'starting',
  "hostname" TEXT NOT NULL,
  "processId" INTEGER NOT NULL,
  "version" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastCycleAt" TIMESTAMP(3),
  "lastCycleDurationMs" INTEGER,
  "lastError" TEXT,
  "stoppedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerHeartbeat_service_lastHeartbeatAt_idx"
  ON "WorkerHeartbeat"("service", "lastHeartbeatAt");
CREATE INDEX "WorkerHeartbeat_status_lastHeartbeatAt_idx"
  ON "WorkerHeartbeat"("status", "lastHeartbeatAt");
