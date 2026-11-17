import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires an explicit driver adapter — there is no implicit
// "read DATABASE_URL and connect" fallback at runtime. See
// PHASE_0_SETUP.md for why, and prisma.config.ts for the CLI-side
// (migrate/studio/seed) connection config.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Standard Next.js-friendly Prisma singleton (avoids exhausting DB
// connections from hot-reloaded route handlers / server components).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "../generated/prisma/client";
export * from "./user-display";
