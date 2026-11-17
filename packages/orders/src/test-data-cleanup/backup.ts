/**
 * No existing backup process was found anywhere in this repo (checked:
 * no pg_dump/backup script, no backup-related package.json entry, no
 * documented process). Postgres is confirmed as the datasource, so this
 * builds a straightforward `pg_dump` backup rather than inventing a
 * project-specific mechanism that doesn't otherwise exist — this becomes
 * the project's backup process for this operation going forward.
 *
 * The connection is handed to pg_dump via the standard PGHOST/PGPORT/
 * PGDATABASE/PGUSER/PGPASSWORD environment variables, parsed out of
 * DATABASE_URL — deliberately NOT as a `postgresql://user:password@...`
 * positional argument, which would put the password in plain sight of
 * `ps aux`/`/proc/<pid>/cmdline` for any other local user (env vars
 * aren't immune to a root/same-user reader either, but they don't leak
 * to every other user the way argv does — this is the standard reason
 * libpq tooling supports the PG* env vars in the first place). Never
 * printed in any log line either way.
 */
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

export type BackupResult =
  | { ok: true; filePath: string; sizeBytes: number }
  | { ok: false; error: string };

/**
 * Prisma's `?schema=public` query parameter on DATABASE_URL is a Prisma-
 * only convention — libpq's own URI parser rejects "schema" as an
 * unrecognized parameter ("invalid URI query parameter"), confirmed
 * against the real staging DB. Parses the URL into the discrete PG* env
 * vars pg_dump actually understands, plus the schema name passed
 * separately via `--schema=`. Defaults to "public" if the URL never had
 * the parameter at all.
 */
function connectionEnvFromUrl(databaseUrl: string): { env: Record<string, string>; schema: string } {
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get("schema") || "public";
  const env: Record<string, string> = {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
  return { env, schema };
}

export async function createBackup(databaseUrl: string, outDir: string): Promise<BackupResult> {
  await mkdir(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outDir, `kisan4u-test-data-cleanup-backup-${timestamp}.dump`);
  const { env: pgEnv, schema } = connectionEnvFromUrl(databaseUrl);

  const exitCode: number | null = await new Promise((resolve) => {
    const child = spawn("pg_dump", ["--format=custom", `--schema=${schema}`, `--file=${filePath}`], {
      env: { ...process.env, ...pgEnv, PGCONNECT_TIMEOUT: "30" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", () => resolve(-1)); // pg_dump not found / failed to spawn
    child.on("close", (code) => {
      if (code !== 0 && stderr) console.error("pg_dump stderr:", stderr.slice(0, 2000));
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    return {
      ok: false,
      error:
        exitCode === -1
          ? "pg_dump is not available in this environment (command not found). Cannot create a verified backup — refusing to apply. Run this from an environment with pg_dump installed, or arrange a backup by another means before applying."
          : `pg_dump exited with code ${exitCode}.`,
    };
  }

  const stats = await stat(filePath).catch(() => null);
  if (!stats || stats.size === 0) {
    return { ok: false, error: `Backup file ${filePath} was not created or is empty.` };
  }
  return { ok: true, filePath, sizeBytes: stats.size };
}
