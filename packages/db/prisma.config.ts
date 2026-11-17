import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 moved connection config out of schema.prisma and into this
// file. Local dev only — DATABASE_URL comes from packages/db/.env
// (git-ignored, copy from .env.example), never a production value.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
