import { PrismaClient } from '@prisma/client';

// Singleton Prisma client — reused across the app
export const prisma = new PrismaClient();
