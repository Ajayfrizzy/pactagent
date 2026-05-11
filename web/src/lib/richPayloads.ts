export type ArtifactKind = 'TEXT' | 'URL' | 'FILE' | 'IMAGE';
export type DisputeResolutionChoice = 'PAYOUT' | 'REFUND' | 'SPLIT';

export type DraftArtifact = {
  id: string;
  kind: ArtifactKind;
  label: string;
  mimeType?: string;
  content: string;
  sizeBytes?: number;
};

export const MAX_ARTIFACT_SIZE_BYTES = 1024 * 1024;
export const MAX_ARTIFACT_SIZE_LABEL = '1 MB';

type RichProofPayload = {
  version: 1;
  kind: 'proof_bundle';
  summary: string;
  primaryText: string | null;
  revision: number;
  createdAt: string;
  artifacts: DraftArtifact[];
};

type RichDisputeEvidencePayload = {
  version: 1;
  kind: 'dispute_evidence_bundle';
  message: string;
  createdAt: string;
  desiredResolution: DisputeResolutionChoice | null;
  splitWorkerAmount: string | null;
  artifacts: DraftArtifact[];
};

type ParsedProofBundle = {
  summary: string;
  primaryText: string;
  revision: number;
  createdAt: string | null;
  artifacts: DraftArtifact[];
  legacyText: boolean;
};

type ParsedDisputeEvidenceBundle = {
  message: string;
  desiredResolution: DisputeResolutionChoice | null;
  splitWorkerAmount: string | null;
  createdAt: string | null;
  artifacts: DraftArtifact[];
  legacyText: boolean;
};

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function parseProofBundle(content: string): ParsedProofBundle {
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
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts as DraftArtifact[] : [],
    legacyText: false,
  };
}

export function parseDisputeEvidenceBundle(content: string): ParsedDisputeEvidenceBundle {
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
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts as DraftArtifact[] : [],
    legacyText: false,
  };
}

export function isImageArtifact(artifact: DraftArtifact) {
  return artifact.kind === 'IMAGE' || artifact.mimeType?.startsWith('image/');
}

export function isDownloadableArtifact(artifact: DraftArtifact) {
  return artifact.kind === 'FILE' || artifact.kind === 'IMAGE';
}

export async function readFilesAsArtifacts(files: FileList | File[]) {
  const list = Array.from(files);

  const oversizedFile = list.find((file) => file.size > MAX_ARTIFACT_SIZE_BYTES);
  if (oversizedFile) {
    throw new Error(
      `${oversizedFile.type.startsWith('image/') ? 'Image' : 'Attachment'} uploads must be ${MAX_ARTIFACT_SIZE_LABEL} or smaller.`
    );
  }

  return Promise.all(
    list.map(async (file, index) => {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      return {
        id: `${Date.now()}-${index}-${file.name}`,
        kind: file.type.startsWith('image/') ? 'IMAGE' as const : 'FILE' as const,
        label: file.name,
        mimeType: file.type || undefined,
        content,
        sizeBytes: file.size || undefined,
      };
    })
  );
}
