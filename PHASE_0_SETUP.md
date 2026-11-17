# Phase 0 — Setup & Run Instructions (Windows)

This covers exactly how to get the Phase 0 scaffold running on Windows. Everything here was verified on this machine (PowerShell, Node.js pre-installed at `C:\Program Files\nodejs`, Docker Desktop). Commands are given for **PowerShell**.

Scope reminder: Phase 0 is scaffolding only — no auth, catalog, cart, checkout, or real third-party integrations. See [BUILD_PHASES.md](BUILD_PHASES.md) for what comes after.

## 1. Prerequisites

- **Node.js 20+** — already present on this machine at `C:\Program Files\nodejs` (verified: v24.18.0), but **not on PATH** in a fresh shell. See §2.
- **pnpm** — installed as a global npm package during setup (see §2). Pinned in [package.json](package.json) via `"packageManager": "pnpm@11.15.1"`.
- **Docker Desktop** — required only when you actually want a running database (§5). Not needed to build, lint, or typecheck.

## 2. One-time PATH / pnpm setup

On this machine, `node`/`npm` exist but aren't on the default PowerShell `PATH`, and pnpm needs `PNPM_HOME` configured before it will run global installs cleanly (pnpm errors with `store-dir` mismatches otherwise — see §8 if you hit this). Run once per new shell session (or add permanently to your PowerShell profile / system environment variables if you want this to persist):

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Users\<you>\AppData\Roaming\npm;" + $env:Path
npm install -g pnpm     # only needed the very first time
$env:PNPM_HOME = "C:\Users\<you>\AppData\Local\pnpm"
if (-not (Test-Path "$env:PNPM_HOME\bin")) { New-Item -ItemType Directory -Path "$env:PNPM_HOME\bin" -Force | Out-Null }
$env:Path = "$env:PNPM_HOME\bin;" + $env:Path
pnpm config set store-dir "C:\Users\<you>\AppData\Local\pnpm\store" --global
```

Verify:

```powershell
node -v      # v20+ 
pnpm -v      # 11.15.1 (or whatever is pinned in package.json)
```

If you'd rather not repeat this every session, add `C:\Program Files\nodejs`, your npm global bin (`%APPDATA%\npm`), and `%LOCALAPPDATA%\pnpm\bin` to your **user** PATH environment variable, and set a persistent `PNPM_HOME` user env var — via Windows Settings → Environment Variables, or ask your assistant to do it for you (not done automatically here, since editing system PATH wasn't necessary once fixed per-session for this build).

## 3. Install dependencies

From the repo root (`kisan4u-nextjs/`):

```powershell
pnpm install
```

The first install will prompt-approve a handful of native postinstall scripts (Prisma engines, esbuild, sharp, unrs-resolver) — this is already pre-approved in [pnpm-workspace.yaml](pnpm-workspace.yaml) (`allowBuilds`), so it should run non-interactively. These are standard, expected build steps for these packages, not anything unusual.

## 4. Environment files (dummy values only)

Every `.env.example` in this repo contains **placeholder/dummy values only** — safe to copy directly for local dev, never pointed at production:

```powershell
Copy-Item packages\db\.env.example packages\db\.env
Copy-Item apps\web\.env.example apps\web\.env.local
Copy-Item apps\dashboard\.env.example apps\dashboard\.env.local
```

(`packages/db/.env` is what Prisma's CLI and the standalone seed script read; the apps use Next's own `.env.local` convention.)

## 5. Local PostgreSQL — Docker (manual step, run this yourself)

**You need to run this yourself** — it wasn't started automatically as part of this build, per the "explain, don't run Docker/migrations" instruction.

```powershell
docker compose up -d
```

This starts a local `postgres:16-alpine` container (service name `postgres`, port `5432`, dummy credentials from `.env.example`/`docker-compose.yml` — `kisan4u_dev` / `kisan4u_dev_password`). Check it's healthy:

```powershell
docker compose ps
```

To stop it later: `docker compose down` (add `-v` to also delete the data volume, e.g. if you want a totally clean database).

## 6. Prisma — generate & migrate (manual step, run this yourself)

The Prisma client is already generated once as part of this build (`packages/db/generated/prisma/`, gitignored) so `pnpm typecheck` and `pnpm build` work without a database. But to actually create the tables in your local Postgres, **you need to run the migration yourself** once Docker is up:

```powershell
pnpm db:migrate
```

This runs `prisma migrate dev` inside `packages/db`, which will prompt you for an initial migration name (e.g. `init`) and apply the schema from `packages/db/prisma/schema.prisma` to your local database. No business data is created — the schema is intentionally empty of seed data in Phase 0 (see `packages/db/prisma/seed.ts`).

Other useful commands (all safe to run any time, all local-only):

```powershell
pnpm db:generate   # regenerate the Prisma client after editing schema.prisma
pnpm db:validate   # schema syntax/relation check only — no DB connection needed
pnpm db:studio     # opens Prisma Studio against your local DB (needs Docker up)
pnpm db:seed       # runs the seed script — currently a no-op scaffold, safe anytime
```

## 7. Running the apps

```powershell
pnpm dev            # both apps in parallel via turbo
pnpm dev:web         # storefront only — http://localhost:3000
pnpm dev:dashboard    # admin+seller dashboard only — http://localhost:3001
```

Both currently render a single placeholder home page confirming the monorepo wiring (they import a shared `PhaseBanner` component from `@kisan4u/ui`).

## 8. Validation commands (all run successfully as of this build)

```powershell
pnpm lint         # ESLint — 7/7 packages pass
pnpm typecheck    # tsc --noEmit — 7/7 packages pass
pnpm build        # next build — both apps build cleanly
pnpm db:validate  # prisma validate — schema is valid
pnpm format:check # prettier --check
```

## 9. Known environment quirks fixed during this build (context, not action needed)

These were resolved while setting up Phase 0 and are already reflected in the committed config — documented here so they're not re-discovered from scratch later:

- **pnpm store-dir mismatch on Windows**: `next build`'s internal dependency auto-installer sometimes spawns pnpm with a different default global store location than the one used for the main `pnpm install`, causing `[ERR_PNPM_UNEXPECTED_STORE]`. Fixed by explicitly configuring `PNPM_HOME` and a global `store-dir` (§2) plus a project-level `store-dir` in [.npmrc](.npmrc).
- **TypeScript pinned to `^5.7.0`, not `*`**: the latest available TypeScript (7.x) at build time isn't yet compatible with Next.js's internal tooling (config loading, type checking crashed with unrelated internal errors). Pinned to the well-established 5.x line across every package.
- **Next.js pinned to `15`, not `*`**: same category of bleeding-edge-version issue was suspected during diagnosis; 15.x is the version this scaffold was verified against. Revisit the pin once ecosystem compatibility (TypeScript, eslint-config-next) catches up to newer majors.
- **`eslint-config-next` bypassed**: it depends on `@rushstack/eslint-patch` for its legacy-config bridge, which throws `Failed to patch ESLint because the calling module was not recognized` under pnpm's `node_modules` layout with current ESLint 9.x — a known upstream fragility, not a config mistake. [packages/config/eslint/next.mjs](packages/config/eslint/next.mjs) rebuilds the equivalent flat config directly from `@next/eslint-plugin-next` + `eslint-plugin-react-hooks` + `typescript-eslint`, bypassing the broken bridge entirely. Revisit going back to `eslint-config-next` directly once that upstream issue is fixed.
- **Prisma 7 configuration model changed**: `datasource.url` is no longer allowed in `schema.prisma` — connection config moved to [packages/db/prisma.config.ts](packages/db/prisma.config.ts), and `PrismaClient` now requires an explicit driver adapter (`@prisma/adapter-pg`) passed at construction — see [packages/db/src/index.ts](packages/db/src/index.ts). The schema also uses the newer `generator client { provider = "prisma-client" }` (TypeScript-source output to `packages/db/generated/prisma/`, gitignored) rather than the older `prisma-client-js`, since the older provider's generated types didn't correctly export `PrismaClient` for adapter-based usage in this Prisma version.

## 10. What's NOT done yet (by design)

No authentication, no product/catalog code, no cart/checkout, no admin/seller dashboards, no real payment/SMS/email/push/WhatsApp/courier integrations. All of that is intentionally deferred — see [BUILD_PHASES.md](BUILD_PHASES.md) Phase 1 onward. Do not start on those until this Phase 0 scaffold has been reviewed and approved.
