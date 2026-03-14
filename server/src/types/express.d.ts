import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      address: string;
      issuedAt: number;
      expiresAt: number;
    };
  }
}
