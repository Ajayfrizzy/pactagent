export const API_KEY_SCOPES = [
  'apps:read',
  'agreements:create',
  'agreements:read',
  'agreements:update',
  'agreements:cancel',
  'milestones:create',
  'milestones:read',
  'escrows:create',
  'escrows:read',
  'escrows:fund',
  'escrows:release',
  'escrows:refund',
  'proofs:create',
  'proofs:read',
  'proofs:review',
  'disputes:create',
  'disputes:read',
  'disputes:resolve',
  'events:read',
  'webhooks:manage',
  'webhooks:read',
  'admin:read',
  'admin:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(scope: string): scope is ApiKeyScope {
  return API_KEY_SCOPES.includes(scope as ApiKeyScope);
}
