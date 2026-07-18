export type AppEnvironment = 'sandbox' | 'production';
export type AppStatus = 'active' | 'disabled' | 'suspended';

export type AppRecord = {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  environment: string;
  status: string;
  defaultCurrency: string;
  defaultNetwork: string;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeApp(app: AppRecord) {
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    ownerUserId: app.ownerUserId,
    environment: app.environment,
    status: app.status,
    defaultCurrency: app.defaultCurrency,
    defaultNetwork: app.defaultNetwork,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}
