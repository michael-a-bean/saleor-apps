import { PrismaClient } from "@prisma/client";

import { getEnv } from "./env.js";

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasourceUrl: getEnv().DATABASE_URL,
      log: getEnv().LOG_LEVEL === "debug" ? ["query", "info", "warn", "error"] : ["warn", "error"],
    });
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
