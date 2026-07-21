const tenantContextBrand: unique symbol = Symbol('TenantContext');

export type TenantContext = Readonly<{
  appId: string;
  [tenantContextBrand]: true;
}>;

export function tenantContext(appId: string): TenantContext {
  const normalized = appId.trim();
  if (!normalized) throw new Error('Tenant context requires a non-empty appId.');
  return Object.freeze({ appId: normalized, [tenantContextBrand]: true as const });
}
