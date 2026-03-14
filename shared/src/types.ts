import {
  AgreementStatus,
  MilestoneStatus,
  ProofType,
  ReleaseMode,
  ReviewerMode,
  PayoutNetwork,
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
  sortOrder: number;
  status: MilestoneStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Agreement {
  id: string;
  title: string;
  description: string;
  clientAddress: string;
  workerAddress: string;
  amount: string;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: ProofType;
  reviewerMode: ReviewerMode;
  releaseMode: ReleaseMode;
  payoutNetwork: PayoutNetwork;
  ckbTxHashCreate: string | null;
  ckbTxHashFund: string | null;
  ckbTxHashRelease: string | null;
  fiberPaymentReference: string | null;
  status: AgreementStatus;
  createdAt: string;
  updatedAt: string;
  milestones?: Milestone[];
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
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: ProofType;
  reviewerMode: ReviewerMode;
  releaseMode: ReleaseMode;
  payoutNetwork: PayoutNetwork;
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
  aiSummary: string | null;
  aiRecommendation: DisputeRecommendation | null;
  aiConfidence: number | null;
  aiRationale: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface OpenDisputeDTO {
  milestoneId: string;
  openedBy: string;
  reason: string;
  evidenceNotes?: string;
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
}

export interface WSEvent {
  type: 'LOG' | 'AGREEMENT_UPDATE';
  payload: AgentLog | Agreement;
}
