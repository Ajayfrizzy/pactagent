export type NormalizedCkbScript = {
  codeHash: string;
  hashType: 'data' | 'type' | 'data1' | 'data2';
  args: string;
};

const HASH_TYPES = new Set<NormalizedCkbScript['hashType']>([
  'data',
  'type',
  'data1',
  'data2',
]);

function normalizeHex(value: unknown, bytes?: number) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.toLowerCase();
  const expected = bytes === undefined ? '[0-9a-f]*' : `[0-9a-f]{${bytes * 2}}`;
  if (!new RegExp(`^0x${expected}$`).test(normalized)) {
    return null;
  }

  return normalized;
}

export function normalizeScript(script: unknown): NormalizedCkbScript | null {
  if (!script || typeof script !== 'object') {
    return null;
  }

  const candidate = script as Record<string, unknown>;
  const codeHash = normalizeHex(candidate.codeHash ?? candidate.code_hash, 32);
  const args = normalizeHex(candidate.args);
  const rawHashType = candidate.hashType ?? candidate.hash_type;
  const hashType = typeof rawHashType === 'string'
    ? rawHashType.toLowerCase() as NormalizedCkbScript['hashType']
    : null;

  if (!codeHash || !args || !hashType || !HASH_TYPES.has(hashType)) {
    return null;
  }

  return { codeHash, hashType, args };
}

export function scriptsEqual(left: unknown, right: unknown) {
  const normalizedLeft = normalizeScript(left);
  const normalizedRight = normalizeScript(right);

  return Boolean(
    normalizedLeft
    && normalizedRight
    && normalizedLeft.codeHash === normalizedRight.codeHash
    && normalizedLeft.hashType === normalizedRight.hashType
    && normalizedLeft.args === normalizedRight.args,
  );
}
