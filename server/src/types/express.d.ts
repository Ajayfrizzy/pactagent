import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    auth?: {
      address: string;
      isAdmin?: boolean;
      issuedAt: number;
      expiresAt: number;
    };
    apiKey?: {
      id: string;
      appId: string;
      name: string;
      keyPrefix: string;
      environment: string;
      scopes: string[];
    };
    currentApp?: {
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
  }
}
