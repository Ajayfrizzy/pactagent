export const ESCROW_LOCK_ARGS_BYTES = 96;
export const ESCROW_CELL_DATA_BYTES = 88;
export const ESCROW_CELL_DATA_VERSION = 1;

const ESCROW_MAGIC = Buffer.from('PACTESC1', 'ascii');
const UINT32_MAX = 0xffff_ffffn;
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;

function fixedHex(value: string, bytes: number, field: string) {
  const normalized = value.toLowerCase();
  if (!new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(normalized)) {
    throw new Error(`${field} must be a ${bytes}-byte 0x-prefixed hex value.`);
  }

  return normalized.slice(2);
}

function unsignedInteger(value: number | bigint, maximum: bigint, field: string) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`${field} must be a safe unsigned integer.`);
  }

  const normalized = BigInt(value);
  if (normalized < 0n || normalized > maximum) {
    throw new Error(`${field} is outside its unsigned integer range.`);
  }

  return normalized;
}

export type EscrowLockArgs = {
  clientLockHash: string;
  workerLockHash: string;
  agreementSalt: string;
};

export function encodeEscrowLockArgs(args: EscrowLockArgs) {
  return `0x${[
    fixedHex(args.clientLockHash, 32, 'clientLockHash'),
    fixedHex(args.workerLockHash, 32, 'workerLockHash'),
    fixedHex(args.agreementSalt, 32, 'agreementSalt'),
  ].join('')}`;
}

export function decodeEscrowLockArgs(encoded: string): EscrowLockArgs {
  const value = fixedHex(encoded, ESCROW_LOCK_ARGS_BYTES, 'lockArgs');
  return {
    clientLockHash: `0x${value.slice(0, 64)}`,
    workerLockHash: `0x${value.slice(64, 128)}`,
    agreementSalt: `0x${value.slice(128, 192)}`,
  };
}

export type EscrowCellData = {
  milestoneIndex: number;
  refundTimeoutSince: bigint;
  agreementDigest: string;
  milestoneDigest: string;
};

export function encodeEscrowCellData(data: EscrowCellData) {
  const milestoneIndex = unsignedInteger(data.milestoneIndex, UINT32_MAX, 'milestoneIndex');
  const refundTimeoutSince = unsignedInteger(data.refundTimeoutSince, UINT64_MAX, 'refundTimeoutSince');
  const encoded = Buffer.alloc(ESCROW_CELL_DATA_BYTES);

  ESCROW_MAGIC.copy(encoded, 0);
  encoded[8] = ESCROW_CELL_DATA_VERSION;
  encoded.writeUInt32LE(Number(milestoneIndex), 12);
  encoded.writeBigUInt64LE(refundTimeoutSince, 16);
  Buffer.from(fixedHex(data.agreementDigest, 32, 'agreementDigest'), 'hex').copy(encoded, 24);
  Buffer.from(fixedHex(data.milestoneDigest, 32, 'milestoneDigest'), 'hex').copy(encoded, 56);

  return `0x${encoded.toString('hex')}`;
}

export function decodeEscrowCellData(encoded: string): EscrowCellData {
  const bytes = Buffer.from(fixedHex(encoded, ESCROW_CELL_DATA_BYTES, 'cellData'), 'hex');
  if (!bytes.subarray(0, 8).equals(ESCROW_MAGIC)) {
    throw new Error('cellData has an invalid escrow magic value.');
  }
  if (bytes[8] !== ESCROW_CELL_DATA_VERSION) {
    throw new Error(`cellData uses unsupported version ${bytes[8]}.`);
  }

  return {
    milestoneIndex: bytes.readUInt32LE(12),
    refundTimeoutSince: bytes.readBigUInt64LE(16),
    agreementDigest: `0x${bytes.subarray(24, 56).toString('hex')}`,
    milestoneDigest: `0x${bytes.subarray(56, 88).toString('hex')}`,
  };
}
