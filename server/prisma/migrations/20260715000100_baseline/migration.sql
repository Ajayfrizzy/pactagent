-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'client',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'active',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'CKB',
    "defaultNetwork" TEXT NOT NULL DEFAULT 'sandbox',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'active',
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "externalReferenceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "clientExternalId" TEXT,
    "workerExternalId" TEXT,
    "clientAddress" TEXT NOT NULL,
    "workerAddress" TEXT NOT NULL,
    "arbitratorAddress" TEXT,
    "workerFiberPubkey" TEXT,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CKB',
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "disputeWindowSecs" INTEGER NOT NULL DEFAULT 86400,
    "proofType" TEXT NOT NULL DEFAULT 'URL',
    "reviewerMode" TEXT NOT NULL DEFAULT 'AUTO',
    "releaseMode" TEXT NOT NULL DEFAULT 'FULL',
    "infrastructureReleaseMode" TEXT,
    "disputeMode" TEXT,
    "sourceType" TEXT,
    "sourceUrl" TEXT,
    "metadataJson" TEXT,
    "payoutNetwork" TEXT NOT NULL DEFAULT 'CKB',
    "escrowModel" TEXT NOT NULL DEFAULT 'TREASURY_BRIDGE',
    "escrowAddress" TEXT,
    "escrowLockCodeHash" TEXT,
    "escrowLockHashType" TEXT,
    "escrowLockArgs" TEXT,
    "agreementDigest" TEXT,
    "milestoneDigest" TEXT,
    "pricingMode" TEXT NOT NULL DEFAULT 'FIXED_CKB',
    "reserveCkbLocked" TEXT NOT NULL DEFAULT '0',
    "reserveCkbRemaining" TEXT NOT NULL DEFAULT '0',
    "reserveFundingQuoteUsdPerCkb" DOUBLE PRECISION,
    "reserveHealthStatus" TEXT NOT NULL DEFAULT 'HEALTHY',
    "settlementStatus" TEXT NOT NULL DEFAULT 'UNFUNDED',
    "fundingConfirmedAt" TIMESTAMP(3),
    "lastSettlementError" TEXT,
    "ckbTxHashCreate" TEXT,
    "ckbTxHashFund" TEXT,
    "ckbTxHashRelease" TEXT,
    "fiberPaymentReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicProfile" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "skillsJson" TEXT,
    "linksJson" TEXT,
    "fiberPubkey" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReputationSnapshot" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "completedAgreements" INTEGER NOT NULL DEFAULT 0,
    "totalFundedAmount" TEXT NOT NULL DEFAULT '0',
    "totalPaidAmount" TEXT NOT NULL DEFAULT '0',
    "payoutSuccessRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disputeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repeatCounterpartyCount" INTEGER NOT NULL DEFAULT 0,
    "onTimeMilestoneRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceAgreementCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReputationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdByAddress" TEXT NOT NULL,
    "creatorRole" TEXT NOT NULL,
    "targetRole" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "agreementTemplateJson" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedByAddress" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementSource" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "forumThreadUrl" TEXT,
    "sourceReferenceId" TEXT,
    "externalMetadataJson" TEXT,
    "sponsorName" TEXT,
    "bountyTitle" TEXT NOT NULL,
    "bountyDescription" TEXT,
    "governanceNotes" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'READY_TO_SYNC',
    "lastSyncedAt" TIMESTAMP(3),
    "latestSummary" TEXT,
    "draftUpdate" TEXT,
    "lastPublishedAt" TIMESTAMP(3),
    "lastPublishedUrl" TEXT,
    "lastPublishedExternalId" TEXT,
    "lastPublishError" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAddress" TEXT,
    "createdByAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgreementSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "appId" TEXT,
    "ownerAddress" TEXT NOT NULL,
    "label" TEXT,
    "targetUrl" TEXT NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "eventTypesJson" TEXT NOT NULL,
    "subscribedEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signingSecret" TEXT NOT NULL,
    "secretHash" TEXT,
    "secretCiphertext" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "appId" TEXT,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT,
    "agreementId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "statusCode" INTEGER,
    "responseBodySnippet" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "externalReferenceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT,
    "targetUsd" DOUBLE PRECISION,
    "releaseQuoteUsdPerCkb" DOUBLE PRECISION,
    "releasedCkbAmount" TEXT,
    "releasedUsdValue" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "escrowFundingTxHash" TEXT,
    "escrowOutputIndex" INTEGER,
    "escrowCellData" TEXT,
    "refundTimeoutBlock" BIGINT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "agreementId" TEXT,
    "milestoneId" TEXT,
    "escrowId" TEXT,
    "proofSubmissionId" TEXT,
    "disputeId" TEXT,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escrow" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rail" TEXT NOT NULL DEFAULT 'mock',
    "network" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'not_created',
    "lockAddress" TEXT,
    "lockTxHash" TEXT,
    "releaseTxHash" TEXT,
    "refundTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "agreementId" TEXT,
    "milestoneId" TEXT,
    "escrowId" TEXT,
    "type" TEXT NOT NULL,
    "rail" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "txHash" TEXT,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rawPayloadJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responseStatus" INTEGER,
    "responseBodyJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Proof" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "submittedByExternalId" TEXT,
    "proofType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "linksJson" TEXT,
    "fileRefsJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "Proof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "proofSubmissionId" TEXT NOT NULL,
    "reviewerExternalId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofCheck" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "warningsJson" TEXT,
    "checklistJson" TEXT,
    "triggeredByAddress" TEXT,
    "triggeredByType" TEXT NOT NULL DEFAULT 'USER',
    "asyncJobId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfoRequest" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "proofId" TEXT,
    "requestType" TEXT NOT NULL DEFAULT 'STRUCTURED_REVIEW_REQUEST',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "requestedBy" TEXT NOT NULL,
    "note" TEXT,
    "questionsJson" TEXT NOT NULL,
    "responseContent" TEXT,
    "respondedBy" TEXT,
    "respondedAt" TIMESTAMP(3),
    "commentId" TEXT,
    "responseCommentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "openedByExternalId" TEXT,
    "openedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceLinksJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolutionType" TEXT,
    "resolutionNote" TEXT,
    "workerAmount" TEXT,
    "clientAmount" TEXT,
    "evidenceNotes" TEXT,
    "aiSummary" TEXT,
    "aiRecommendation" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "aiRationale" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLog" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT,
    "level" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "appId" TEXT,
    "agreementId" TEXT,
    "actorAddress" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadataJson" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneSettlement" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "direction" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" TEXT NOT NULL,
    "txHash" TEXT,
    "paymentReference" TEXT,
    "errorMessage" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MilestoneSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementComment" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "authorAddress" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgreementComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementAmendment" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "reason" TEXT,
    "title" TEXT,
    "description" TEXT,
    "deadlineAt" TIMESTAMP(3),
    "disputeWindowSecs" INTEGER,
    "releaseMode" TEXT,
    "payoutNetwork" TEXT,
    "workerFiberPubkey" TEXT,
    "milestonesJson" TEXT,
    "responseNote" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgreementAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT,
    "payloadJson" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "App_ownerUserId_createdAt_idx" ON "App"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "App_environment_status_idx" ON "App"("environment", "status");

-- CreateIndex
CREATE UNIQUE INDEX "App_ownerUserId_slug_key" ON "App"("ownerUserId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_appId_status_idx" ON "ApiKey"("appId", "status");

-- CreateIndex
CREATE INDEX "ApiKey_keyPrefix_idx" ON "ApiKey"("keyPrefix");

-- CreateIndex
CREATE INDEX "ApiKey_environment_status_idx" ON "ApiKey"("environment", "status");

-- CreateIndex
CREATE INDEX "Agreement_appId_createdAt_idx" ON "Agreement"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "Agreement_clientAddress_createdAt_idx" ON "Agreement"("clientAddress", "createdAt");

-- CreateIndex
CREATE INDEX "Agreement_workerAddress_createdAt_idx" ON "Agreement"("workerAddress", "createdAt");

-- CreateIndex
CREATE INDEX "Agreement_status_createdAt_idx" ON "Agreement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Agreement_settlementStatus_createdAt_idx" ON "Agreement"("settlementStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Agreement_deadlineAt_idx" ON "Agreement"("deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "Agreement_appId_externalReferenceId_key" ON "Agreement"("appId", "externalReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Agreement_id_appId_key" ON "Agreement"("id", "appId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicProfile_walletAddress_key" ON "PublicProfile"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "PublicProfile_handle_key" ON "PublicProfile"("handle");

-- CreateIndex
CREATE INDEX "PublicProfile_visibility_handle_idx" ON "PublicProfile"("visibility", "handle");

-- CreateIndex
CREATE INDEX "PublicProfile_walletAddress_visibility_idx" ON "PublicProfile"("walletAddress", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "ReputationSnapshot_walletAddress_key" ON "ReputationSnapshot"("walletAddress");

-- CreateIndex
CREATE INDEX "ReputationSnapshot_walletAddress_updatedAt_idx" ON "ReputationSnapshot"("walletAddress", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InviteLink_token_key" ON "InviteLink"("token");

-- CreateIndex
CREATE INDEX "InviteLink_createdByAddress_createdAt_idx" ON "InviteLink"("createdByAddress", "createdAt");

-- CreateIndex
CREATE INDEX "InviteLink_isActive_expiresAt_idx" ON "InviteLink"("isActive", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementSource_agreementId_key" ON "AgreementSource"("agreementId");

-- CreateIndex
CREATE INDEX "AgreementSource_sourceType_createdAt_idx" ON "AgreementSource"("sourceType", "createdAt");

-- CreateIndex
CREATE INDEX "AgreementSource_createdByAddress_createdAt_idx" ON "AgreementSource"("createdByAddress", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_appId_status_createdAt_idx" ON "WebhookEndpoint"("appId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_ownerAddress_createdAt_idx" ON "WebhookEndpoint"("ownerAddress", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_isActive_createdAt_idx" ON "WebhookEndpoint"("isActive", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_id_appId_key" ON "WebhookEndpoint"("id", "appId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_appId_createdAt_idx" ON "WebhookDelivery"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_appId_status_nextRetryAt_idx" ON "WebhookDelivery"("appId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_eventId_createdAt_idx" ON "WebhookDelivery"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextRetryAt_createdAt_idx" ON "WebhookDelivery"("status", "nextRetryAt", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_agreementId_createdAt_idx" ON "WebhookDelivery"("agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "Milestone_appId_createdAt_idx" ON "Milestone"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "Milestone_agreementId_status_idx" ON "Milestone"("agreementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_appId_externalReferenceId_key" ON "Milestone"("appId", "externalReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_agreementId_sortOrder_key" ON "Milestone"("agreementId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_id_appId_key" ON "Milestone"("id", "appId");

-- CreateIndex
CREATE INDEX "Event_appId_createdAt_idx" ON "Event"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_appId_type_createdAt_idx" ON "Event"("appId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Event_agreementId_createdAt_idx" ON "Event"("agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_milestoneId_createdAt_idx" ON "Event"("milestoneId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_id_appId_key" ON "Event"("id", "appId");

-- CreateIndex
CREATE INDEX "Escrow_appId_createdAt_idx" ON "Escrow"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "Escrow_appId_status_createdAt_idx" ON "Escrow"("appId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Escrow_agreementId_createdAt_idx" ON "Escrow"("agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "Escrow_milestoneId_createdAt_idx" ON "Escrow"("milestoneId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_id_appId_key" ON "Escrow"("id", "appId");

-- CreateIndex
CREATE INDEX "Transaction_appId_createdAt_idx" ON "Transaction"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_escrowId_type_createdAt_idx" ON "Transaction"("escrowId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_agreementId_createdAt_idx" ON "Transaction"("agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_milestoneId_createdAt_idx" ON "Transaction"("milestoneId", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_appId_createdAt_idx" ON "IdempotencyKey"("appId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_appId_key_key" ON "IdempotencyKey"("appId", "key");

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- CreateIndex
CREATE INDEX "Proof_appId_submittedAt_idx" ON "Proof"("appId", "submittedAt");

-- CreateIndex
CREATE INDEX "Proof_agreementId_milestoneId_submittedAt_idx" ON "Proof"("agreementId", "milestoneId", "submittedAt");

-- CreateIndex
CREATE INDEX "Proof_milestoneId_reviewStatus_submittedAt_idx" ON "Proof"("milestoneId", "reviewStatus", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Proof_id_appId_key" ON "Proof"("id", "appId");

-- CreateIndex
CREATE INDEX "Review_appId_createdAt_idx" ON "Review"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_proofSubmissionId_createdAt_idx" ON "Review"("proofSubmissionId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_agreementId_createdAt_idx" ON "Review"("agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "ProofCheck_agreementId_milestoneId_createdAt_idx" ON "ProofCheck"("agreementId", "milestoneId", "createdAt");

-- CreateIndex
CREATE INDEX "ProofCheck_proofId_createdAt_idx" ON "ProofCheck"("proofId", "createdAt");

-- CreateIndex
CREATE INDEX "ProofCheck_status_createdAt_idx" ON "ProofCheck"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InfoRequest_agreementId_milestoneId_createdAt_idx" ON "InfoRequest"("agreementId", "milestoneId", "createdAt");

-- CreateIndex
CREATE INDEX "InfoRequest_status_createdAt_idx" ON "InfoRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_appId_createdAt_idx" ON "Dispute"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_agreementId_milestoneId_resolvedAt_idx" ON "Dispute"("agreementId", "milestoneId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_id_appId_key" ON "Dispute"("id", "appId");

-- CreateIndex
CREATE INDEX "DisputeEvidence_disputeId_createdAt_idx" ON "DisputeEvidence"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentLog_agreementId_createdAt_idx" ON "AgentLog"("agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentLog_eventType_createdAt_idx" ON "AgentLog"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_appId_createdAt_idx" ON "AuditLog"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_agreementId_createdAt_idx" ON "AuditLog"("agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorAddress_createdAt_idx" ON "AuditLog"("actorAddress", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_requestId_createdAt_idx" ON "AuditLog"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_createdAt_idx" ON "AuditLog"("resourceType", "resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "MilestoneSettlement_agreementId_direction_status_createdAt_idx" ON "MilestoneSettlement"("agreementId", "direction", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MilestoneSettlement_milestoneId_direction_createdAt_idx" ON "MilestoneSettlement"("milestoneId", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "AgreementComment_agreementId_createdAt_idx" ON "AgreementComment"("agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "AgreementAmendment_agreementId_status_createdAt_idx" ON "AgreementAmendment"("agreementId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentJob_dedupeKey_key" ON "AgentJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "AgentJob_status_availableAt_createdAt_idx" ON "AgentJob"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "AgentJob_agreementId_createdAt_idx" ON "AgentJob"("agreementId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementSource" ADD CONSTRAINT "AgreementSource_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_proofSubmissionId_fkey" FOREIGN KEY ("proofSubmissionId") REFERENCES "Proof"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofCheck" ADD CONSTRAINT "ProofCheck_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofCheck" ADD CONSTRAINT "ProofCheck_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofCheck" ADD CONSTRAINT "ProofCheck_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "Proof"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfoRequest" ADD CONSTRAINT "InfoRequest_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfoRequest" ADD CONSTRAINT "InfoRequest_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfoRequest" ADD CONSTRAINT "InfoRequest_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "Proof"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLog" ADD CONSTRAINT "AgentLog_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneSettlement" ADD CONSTRAINT "MilestoneSettlement_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneSettlement" ADD CONSTRAINT "MilestoneSettlement_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementComment" ADD CONSTRAINT "AgreementComment_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementAmendment" ADD CONSTRAINT "AgreementAmendment_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
