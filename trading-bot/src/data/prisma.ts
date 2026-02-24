import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

export function getPrismaClient() {
  if (!prisma) {
    prisma = new PrismaClient();
  }

  return prisma;
}

export async function connectDatabase() {
  const client = getPrismaClient();
  await client.$connect();
  return client;
}
