import {
  AgreementStatus,
  EscrowModel,
  MilestoneStatus,
  ProofType,
  ReleaseMode,
  ReviewerMode,
  PayoutNetwork,
  PricingMode,
  ReserveHealthStatus,
  SettlementDirection,
  SettlementRecordStatus,
  SettlementStatus,
  LogLevel,
  AgentEventType,
  DisputeRecommendation,
} from './enums';

export interface Milestone {
  id: string;
  agreementId: string;
  title: string;
  description: string;
  amount: string;
  targetUsd?: number | null;
  releaseQuoteUsdPerCkb?: number | null;
  releasedCkbAmount?: string | null;
  releasedUsdValue?: number | null;
  sortOrder: number;
  status: MilestoneStatus;
  escrowFundingTxHash: string | null;
  escrowOutputIndex: number | null;
  escrowCellData: string | null;
  refundTimeoutBlock: string | null;
  createdAt: string;
  updatedAt: string;
  revisionCount?: number;
  settlements?: MilestoneSettlement[];
}

export interface Agreement {
  id: string;
  title: string;
  description: string;
  clientAddress: string;
  workerAddress: string;
  arbitratorAddress: string | null;
  workerFiberPubkey: string | null;
  amount: string;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: ProofType;
  reviewerMode: ReviewerMode;
  releaseMode: ReleaseMode;
  payoutNetwork: PayoutNetwork;
  escrowModel: EscrowModel;
  escrowAddress: string | null;
  escrowLockCodeHash: string | null;
  escrowLockHashType: string | null;
  escrowLockArgs: string | null;
  agreementDigest: string | null;
  milestoneDigest: string | null;
  pricingMode: PricingMode;
  reserveCkbLocked: string;
  reserveCkbRemaining: string;
  reserveFundingQuoteUsdPerCkb: number | null;
  reserveHealthStatus: ReserveHealthStatus;
  settlementStatus: SettlementStatus;
  fundingConfirmedAt: string | null;
  lastSettlementError: string | null;
  ckbTxHashCreate: string | null;
  ckbTxHashFund: string | null;
  ckbTxHashRelease: string | null;
  fiberPaymentReference: string | null;
  status: AgreementStatus;
  createdAt: string;
  updatedAt: string;
  workflowStage?: string;
  nextParticipantAction?: string | null;
  milestones?: Milestone[];
  settlements?: MilestoneSettlement[];
  comments?: AgreementComment[];
  amendments?: AgreementAmendment[];
  jobs?: AgentJob[];
  proofChecks?: ProofCheck[];
  infoRequests?: InfoRequest[];
}

export interface MilestoneSettlement {
  id: string;
  agreementId: string;
  milestoneId: string | null;
  direction: SettlementDirection;
  network: PayoutNetwork | 'INTERNAL';
  status: SettlementRecordStatus;
  amount: string;
  txHash: string | null;
  paymentReference: string | null;
  errorMessage: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMilestoneDTO {
  title: string;
  description: string;
  amount: string;
}

export interface CreateAgreementDTO {
  title: string;
  description: string;
  clientAddress: string;
  workerAddress: string;
  workerFiberPubkey?: string;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: ProofType;
  reviewerMode: ReviewerMode;
  releaseMode: ReleaseMode;
  payoutNetwork: PayoutNetwork;
  escrowModel?: EscrowModel;
  milestones: CreateMilestoneDTO[];
}

export interface FundAgreementDTO {
  txHash: string;
}

export interface Proof {
  id: string;
  agreementId: string;
  milestoneId: string;
  proofType: ProofType;
  content: string;
  contentHash: string;
  submittedAt: string;
  reviewStatus?: 'UNREVIEWED' | 'CHECKING' | 'ISSUES_FOUND' | 'READY_FOR_HUMAN_REVIEW' | 'NEEDS_MORE_INFO';
  lastCheckedAt?: string | null;
}

export interface ProofCheckChecklistItem {
  key: 'links' | 'tx_hash' | 'screenshots' | 'scope';
  label: string;
  status: 'PRESENT' | 'MISSING' | 'PARTIAL' | 'NOT_APPLICABLE';
  detail: string;
  warning: string | null;
}

export interface ProofCheck {
  id: string;
  agreementId: string;
  milestoneId: string;
  proofId: string;
  status: 'CHECKING' | 'ISSUES_FOUND' | 'READY_FOR_HUMAN_REVIEW' | 'NEEDS_MORE_INFO';
  issueCount: number;
  warningCount: number;
  summary: string;
  warningsJson: string | null;
  checklistJson: string | null;
  triggeredByAddress: string | null;
  triggeredByType: 'USER' | 'SYSTEM';
  asyncJobId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InfoRequest {
  id: string;
  agreementId: string;
  milestoneId: string;
  proofId: string | null;
  requestType: 'STRUCTURED_REVIEW_REQUEST' | 'MESSAGE';
  status: 'OPEN' | 'RESPONDED' | 'CLOSED';
  requestedBy: string;
  note: string | null;
  questionsJson: string;
  responseContent: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  commentId: string | null;
  responseCommentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RichArtifact {
  id: string;
  kind: 'TEXT' | 'URL' | 'FILE' | 'IMAGE';
  label: string;
  mimeType: string | null;
  content: string;
  sizeBytes: number | null;
}

export interface ParsedProofBundle {
  summary: string;
  primaryText: string;
  revision: number;
  createdAt: string | null;
  artifacts: RichArtifact[];
  legacyText: boolean;
}

export interface SubmitProofDTO {
  milestoneId: string;
  proofType: ProofType;
  content: string;
  contentHash?: string;
}

export interface Dispute {
  id: string;
  agreementId: string;
  milestoneId: string;
  openedBy: string;
  reason: string;
  evidenceNotes: string | null;
  evidenceEntries?: DisputeEvidence[];
  aiSummary: string | null;
  aiRecommendation: DisputeRecommendation | null;
  aiConfidence: number | null;
  aiRationale: string | null;
  refundConsensus?: RefundConsensus | null;
  splitConsensus?: SplitConsensus | null;
  workspaceState?: DisputeWorkspaceState | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface RefundConsensus {
  proposedBy: string | null;
  proposedAt: string | null;
  clientApprovedAt: string | null;
  workerApprovedAt: string | null;
  fullyApproved: boolean;
  awaitingAddress: string | null;
}

export interface SplitConsensus {
  proposedBy: string | null;
  proposedAt: string | null;
  clientApprovedAt: string | null;
  workerApprovedAt: string | null;
  workerAmount: string | null;
  clientRefundAmount: string | null;
  fullyApproved: boolean;
  awaitingAddress: string | null;
}

export interface DisputeWorkspaceState {
  stage: 'AWAITING_RESPONSE' | 'READY_FOR_REVIEW' | 'NEGOTIATING_REFUND' | 'NEGOTIATING_SPLIT' | 'RESOLVED';
  responseDeadlineAt: string | null;
  counterpartyAddress: string | null;
  awaitingAddress: string | null;
}

export interface DisputeEvidence {
  id: string;
  disputeId: string;
  submittedBy: string;
  content: string;
  createdAt: string;
}

export interface ParsedDisputeEvidenceBundle {
  message: string;
  desiredResolution: 'PAYOUT' | 'REFUND' | 'SPLIT' | null;
  splitWorkerAmount: string | null;
  createdAt: string | null;
  artifacts: RichArtifact[];
  legacyText: boolean;
}

export interface OpenDisputeDTO {
  milestoneId: string;
  openedBy: string;
  reason: string;
  evidenceNotes?: string;
}

export interface AddDisputeEvidenceDTO {
  disputeId: string;
  submittedBy: string;
  content: string;
}

export interface AgentLog {
  id: string;
  agreementId: string | null;
  level: LogLevel;
  eventType: AgentEventType;
  message: string;
  metadataJson: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  agreementId: string | null;
  actorAddress: string | null;
  actorType: 'USER' | 'SYSTEM';
  action: string;
  resourceType: string;
  resourceId: string;
  metadataJson: string | null;
  createdAt: string;
}

export interface AgreementComment {
  id: string;
  agreementId: string;
  authorAddress: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgreementAmendment {
  id: string;
  agreementId: string;
  proposedBy: string;
  status: string;
  reason: string | null;
  title: string | null;
  description: string | null;
  deadlineAt: string | null;
  disputeWindowSecs: number | null;
  releaseMode: string | null;
  payoutNetwork: string | null;
  workerFiberPubkey: string | null;
  milestonesJson: string | null;
  responseNote: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentJob {
  id: string;
  agreementId: string | null;
  kind: string;
  status: string;
  dedupeKey: string | null;
  payloadJson: string | null;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  completedAt: string | null;
  deadLetteredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AIRecommendationResponse {
  summary: string;
  recommendation: DisputeRecommendation;
  confidence: number;
  rationale: string;
}

export interface ReviewActionDTO {
  action: 'APPROVE' | 'REJECT' | 'ESCALATE';
  reviewerAddress: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AppConfig {
  ckbNodeUrl: string;
  ckbNetwork: 'testnet' | 'mainnet';
  fiberEnabled: boolean;
  aiEnabled: boolean;
  agentIntervalMs: number;
  treasuryAddress: string | null;
  onchainEscrowEnabled: boolean;
  onchainEscrowReady: boolean;
  supportedEscrowModels: Array<'TREASURY_BRIDGE' | 'ONCHAIN_LOCK'>;
  onchainLockTxHash?: string | null;
  onchainLockIndex?: string | null;
  onchainLockDepType?: 'code' | 'depGroup' | null;
}

export interface WSEvent {
  type: 'LOG' | 'AGREEMENT_UPDATE';
  payload: AgentLog | Agreement;
}
