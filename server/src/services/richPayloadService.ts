import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';

export type ArtifactKind = 'TEXT' | 'URL' | 'FILE' | 'IMAGE';
export type DisputeResolutionChoice = 'PAYOUT' | 'REFUND' | 'SPLIT';

export type ArtifactInput = {
  id?: string;
  kind: ArtifactKind;
  label?: string;
  mimeType?: string;
  content: string;
  sizeBytes?: number;
};

type RichArtifact = {
  id: string;
  kind: ArtifactKind;
  label: string;
  mimeType: string | null;
  content: string;
  sizeBytes: number | null;
};

type RichProofPayload = {
  version: 1;
  kind: 'proof_bundle';
  summary: string;
  primaryText: string | null;
  revision: number;
  createdAt: string;
  artifacts: RichArtifact[];
};

type RichDisputeEvidencePayload = {
  version: 1;
  kind: 'dispute_evidence_bundle';
  message: string;
  createdAt: string;
  desiredResolution: DisputeResolutionChoice | null;
  splitWorkerAmount: string | null;
  artifacts: RichArtifact[];
};

export type ParsedRichProof = {
  summary: string;
  primaryText: string;
  revision: number;
  createdAt: string | null;
  artifacts: RichArtifact[];
  legacyText: boolean;
};

export type ParsedRichDisputeEvidence = {
  message: string;
  desiredResolution: DisputeResolutionChoice | null;
  splitWorkerAmount: string | null;
  createdAt: string | null;
  artifacts: RichArtifact[];
  legacyText: boolean;
};

function sanitizeArtifact(input: ArtifactInput, index: number): RichArtifact {
  const kind = input.kind;
  const content = input.content.trim();
  const label =
    input.label?.trim()
    || (kind === 'URL'
      ? `Link ${index + 1}`
      : kind === 'IMAGE'
        ? `Image ${index + 1}`
        : kind === 'FILE'
          ? `File ${index + 1}`
          : `Note ${index + 1}`);

  return {
    id: input.id || uuid(),
    kind,
    label,
    mimeType: input.mimeType?.trim() || null,
    content,
    sizeBytes: typeof input.sizeBytes === 'number' ? input.sizeBytes : null,
  };
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function serializeProofBundle(input: {
  summary?: string;
  primaryText?: string;
  artifacts?: ArtifactInput[];
  revision: number;
  createdAt?: string;
}) {
  const payload: RichProofPayload = {
    version: 1,
    kind: 'proof_bundle',
    summary: input.summary?.trim() || '',
    primaryText: input.primaryText?.trim() || null,
    revision: input.revision,
    createdAt: input.createdAt || new Date().toISOString(),
    artifacts: (input.artifacts || [])
      .map((artifact, index) => sanitizeArtifact(artifact, index))
      .filter((artifact) => artifact.content.length > 0),
  };

  return JSON.stringify(payload);
}

export function parseProofBundle(content: string): ParsedRichProof {
  const parsed = parseJson<Partial<RichProofPayload>>(content);
  if (!parsed || parsed.kind !== 'proof_bundle' || parsed.version !== 1) {
    return {
      summary: '',
      primaryText: content,
      revision: 1,
      createdAt: null,
      artifacts: [],
      legacyText: true,
    };
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    primaryText: typeof parsed.primaryText === 'string' ? parsed.primaryText : '',
    revision: typeof parsed.revision === 'number' ? parsed.revision : 1,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    artifacts: Array.isArray(parsed.artifacts)
      ? parsed.artifacts.filter((artifact): artifact is RichArtifact =>
          Boolean(
            artifact
            && typeof artifact === 'object'
            && typeof artifact.id === 'string'
            && typeof artifact.kind === 'string'
            && typeof artifact.label === 'string'
            && typeof artifact.content === 'string'
          )
        )
      : [],
    legacyText: false,
  };
}

export function serializeDisputeEvidenceBundle(input: {
  message?: string;
  desiredResolution?: DisputeResolutionChoice | null;
  splitWorkerAmount?: string | null;
  artifacts?: ArtifactInput[];
  createdAt?: string;
}) {
  const payload: RichDisputeEvidencePayload = {
    version: 1,
    kind: 'dispute_evidence_bundle',
    message: input.message?.trim() || '',
    createdAt: input.createdAt || new Date().toISOString(),
    desiredResolution: input.desiredResolution || null,
    splitWorkerAmount: input.splitWorkerAmount?.trim() || null,
    artifacts: (input.artifacts || [])
      .map((artifact, index) => sanitizeArtifact(artifact, index))
      .filter((artifact) => artifact.content.length > 0),
  };

  return JSON.stringify(payload);
}

export function parseDisputeEvidenceBundle(content: string): ParsedRichDisputeEvidence {
  const parsed = parseJson<Partial<RichDisputeEvidencePayload>>(content);
  if (!parsed || parsed.kind !== 'dispute_evidence_bundle' || parsed.version !== 1) {
    return {
      message: content,
      desiredResolution: null,
      splitWorkerAmount: null,
      createdAt: null,
      artifacts: [],
      legacyText: true,
    };
  }

  return {
    message: typeof parsed.message === 'string' ? parsed.message : '',
    desiredResolution:
      parsed.desiredResolution === 'PAYOUT'
      || parsed.desiredResolution === 'REFUND'
      || parsed.desiredResolution === 'SPLIT'
        ? parsed.desiredResolution
        : null,
    splitWorkerAmount: typeof parsed.splitWorkerAmount === 'string' ? parsed.splitWorkerAmount : null,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    artifacts: Array.isArray(parsed.artifacts)
      ? parsed.artifacts.filter((artifact): artifact is RichArtifact =>
          Boolean(
            artifact
            && typeof artifact === 'object'
            && typeof artifact.id === 'string'
            && typeof artifact.kind === 'string'
            && typeof artifact.label === 'string'
            && typeof artifact.content === 'string'
          )
        )
      : [],
    legacyText: false,
  };
}

export function computeContentHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
