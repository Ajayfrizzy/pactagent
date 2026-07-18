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
import { isAdminAddress } from '../middleware/admin';

type ChallengeRecord = {
  message: string;
  expiresAt: number;
};

const challengeStore = new Map<string, ChallengeRecord>();

function jwtSigningKey() {
  return requireConfig(
    config.authJwtKeys[config.authJwtActiveKid] || config.authJwtSecret,
    `JWT signing key ${config.authJwtActiveKid}`,
  );
}

function jwtVerificationKey(token: string) {
  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded?.header.kid;
  if (kid && config.authJwtKeys[kid]) {
    return config.authJwtKeys[kid];
  }
  if (!kid || kid === 'legacy') {
    return requireConfig(config.authJwtSecret || config.authJwtKeys.legacy, 'legacy JWT verification key');
  }
  throw new Error('Unknown authentication token key ID.');
}

function getClient() {
  return config.ckbNetwork === 'mainnet'
    ? new ClientPublicMainnet({ url: config.ckbNodeUrl })
    : new ClientPublicTestnet({ url: config.ckbNodeUrl });
}

export function normalizeWalletAddress(address: string): string {
  return address.trim().toLowerCase();
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
  const normalized = normalizeWalletAddress(address);
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
  requestedAddress?: string;
}) {
  const client = getClient();

  if (signature.signType === SignerSignType.CkbSecp256k1) {
    return new SignerCkbPublicKey(client, signature.identity).getRecommendedAddress();
  }

  if (signature.signType === SignerSignType.JoyId) {
    try {
      const identity = JSON.parse(signature.identity) as {
        address?: string;
        publicKey?: string;
      };

      if (identity.address) {
        return normalizeWalletAddress(identity.address);
      }

      if (identity.publicKey) {
        const publicKey = identity.publicKey.startsWith('0x')
          ? identity.publicKey
          : `0x${identity.publicKey}`;
        const byteLength = (publicKey.length - 2) / 2;

        if (byteLength === 33) {
          return new SignerCkbPublicKey(client, publicKey).getRecommendedAddress();
        }
      }
    } catch {
      // Fall back to the requested address after successful signature verification.
    }
  }

  if (signature.signType === 'EvmPersonal' && signature.requestedAddress) {
    return normalizeWalletAddress(signature.requestedAddress);
  }

  if (signature.signType === SignerSignType.JoyId && signature.requestedAddress) {
    return normalizeWalletAddress(signature.requestedAddress);
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
  const normalized = normalizeWalletAddress(params.address);
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

  const derivedAddress = await deriveAddressFromSignatureIdentity({
    ...params.signature,
    requestedAddress: normalized,
  });
  if (normalizeWalletAddress(derivedAddress) !== normalized) {
    throw new Error('Signed wallet address does not match the requested account.');
  }

  challengeStore.delete(normalized);

  const token = jwt.sign(
    { address: normalized },
    jwtSigningKey(),
    { expiresIn: config.authTokenTtlSecs, keyid: config.authJwtActiveKid, algorithm: 'HS256' }
  );

  return {
    token,
    address: normalized,
    isAdmin: isAdminAddress(normalized),
    expiresAt: new Date(Date.now() + config.authTokenTtlSecs * 1000).toISOString(),
  };
}

export function verifyAuthToken(token: string) {
  const decoded = jwt.verify(
    token,
    jwtVerificationKey(token),
    { algorithms: ['HS256'] },
  ) as jwt.JwtPayload & { address: string };

  if (!decoded.address || typeof decoded.address !== 'string') {
    throw new Error('Invalid authentication token.');
  }

  return {
    address: normalizeWalletAddress(decoded.address),
    isAdmin: isAdminAddress(decoded.address),
    issuedAt: typeof decoded.iat === 'number' ? decoded.iat : 0,
    expiresAt: typeof decoded.exp === 'number' ? decoded.exp : 0,
  };
}
