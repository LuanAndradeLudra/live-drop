import { PrismaClient } from '@prisma/client';

// Singleton do Prisma Client
let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prisma;
}

// Exporta o tipo Prisma para uso nos repositórios
export type { Prisma } from '@prisma/client';

