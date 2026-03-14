import jwt from 'jsonwebtoken';
import {
  ClientPublicMainnet,
  ClientPublicTestnet,
  Signature,
  Signer,
  SignerCkbPublicKey,
  SignerSignType,
} from '@ckb-ccc/core';
import { config, requireConfig } from '../config';

type ChallengeRecord = {
  message: string;
  expiresAt: number;
};

const challengeStore = new Map<string, ChallengeRecord>();

function getClient() {
  return config.ckbNetwork === 'mainnet'
    ? new ClientPublicMainnet({ url: config.ckbNodeUrl })
    : new ClientPublicTestnet({ url: config.ckbNodeUrl });
}

function normalizeAddress(address: string): string {
  return address.trim();
}

function buildChallengeMessage(address: string, nonce: string) {
  return [
    'PactAgent Authentication',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
    '',
    'Sign this message to authenticate with PactAgent.',
  ].join('\n');
}

export function createChallenge(address: string) {
  const normalized = normalizeAddress(address);
  const nonce = crypto.randomUUID();
  const message = buildChallengeMessage(normalized, nonce);
  challengeStore.set(normalized, {
    message,
    expiresAt: Date.now() + config.authChallengeTtlSecs * 1000,
  });

  return {
    message,
    expiresAt: new Date(Date.now() + config.authChallengeTtlSecs * 1000).toISOString(),
  };
}

async function deriveAddressFromSignatureIdentity(signature: {
  signType: string;
  identity: string;
}) {
  const client = getClient();

  if (signature.signType === SignerSignType.CkbSecp256k1) {
    return new SignerCkbPublicKey(client, signature.identity).getRecommendedAddress();
  }

  if (signature.signType === SignerSignType.JoyId) {
    const identity = JSON.parse(signature.identity) as { publicKey: string };
    const publicKey = identity.publicKey.startsWith('0x')
      ? identity.publicKey
      : `0x${identity.publicKey}`;
    return new SignerCkbPublicKey(client, publicKey).getRecommendedAddress();
  }

  throw new Error(`Unsupported signer type for authentication: ${signature.signType}`);
}

export async function verifyChallenge(params: {
  address: string;
  message: string;
  signature: {
    signature: string;
    identity: string;
    signType: string;
  };
}) {
  const normalized = normalizeAddress(params.address);
  const challenge = challengeStore.get(normalized);

  if (!challenge) {
    throw new Error('Authentication challenge not found. Please request a new one.');
  }

  if (challenge.expiresAt < Date.now()) {
    challengeStore.delete(normalized);
    throw new Error('Authentication challenge has expired. Please request a new one.');
  }

  if (challenge.message !== params.message) {
    throw new Error('Challenge message mismatch.');
  }

  const signature = new Signature(
    params.signature.signature,
    params.signature.identity,
    params.signature.signType as SignerSignType
  );

  const isValidSignature = await Signer.verifyMessage(params.message, signature);
  if (!isValidSignature) {
    throw new Error('Wallet signature verification failed.');
  }

  const derivedAddress = await deriveAddressFromSignatureIdentity(params.signature);
  if (normalizeAddress(derivedAddress) !== normalized) {
    throw new Error('Signed wallet address does not match the requested account.');
  }

  challengeStore.delete(normalized);

  const token = jwt.sign(
    { address: normalized },
    requireConfig(config.authJwtSecret, 'AUTH_JWT_SECRET'),
    { expiresIn: config.authTokenTtlSecs }
  );

  return {
    token,
    address: normalized,
    expiresAt: new Date(Date.now() + config.authTokenTtlSecs * 1000).toISOString(),
  };
}

export function verifyAuthToken(token: string) {
  const decoded = jwt.verify(
    token,
    requireConfig(config.authJwtSecret, 'AUTH_JWT_SECRET')
  ) as jwt.JwtPayload & { address: string };

  if (!decoded.address || typeof decoded.address !== 'string') {
    throw new Error('Invalid authentication token.');
  }

  return {
    address: normalizeAddress(decoded.address),
    issuedAt: typeof decoded.iat === 'number' ? decoded.iat : 0,
    expiresAt: typeof decoded.exp === 'number' ? decoded.exp : 0,
  };
}
