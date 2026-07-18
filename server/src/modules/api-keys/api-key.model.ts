import { maskApiKey } from '../../common/crypto/api-keys';

export type ApiKeyRecord = {
  id: string;
  appId: string;
  name: string;
  keyPrefix: string;
  environment: string;
  status: string;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
};

export function serializeApiKey(apiKey: ApiKeyRecord) {
  return {
    id: apiKey.id,
    appId: apiKey.appId,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    maskedKey: maskApiKey(apiKey.keyPrefix),
    environment: apiKey.environment,
    status: apiKey.status,
    scopes: apiKey.scopes,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
    revokedAt: apiKey.revokedAt?.toISOString() ?? null,
  };
}

export function serializeCreatedApiKey(apiKey: ApiKeyRecord, rawKey: string) {
  return {
    ...serializeApiKey(apiKey),
    key: rawKey,
  };
}
