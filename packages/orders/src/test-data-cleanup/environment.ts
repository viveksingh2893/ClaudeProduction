/** Parses DATABASE_URL for display only — host/port/database name, never the username or password. */
export type EnvironmentIdentity = {
  host: string;
  port: string;
  database: string;
  /** Heuristic only, based on the database name — never authoritative. Always confirm with the user before assuming. */
  guess: "local" | "staging" | "production" | "unknown";
};

export function identifyEnvironment(databaseUrl: string | undefined): EnvironmentIdentity {
  if (!databaseUrl) {
    return { host: "(unset)", port: "(unset)", database: "(unset)", guess: "unknown" };
  }
  try {
    const url = new URL(databaseUrl);
    const database = url.pathname.replace(/^\//, "") || "(unknown)";
    const lower = database.toLowerCase();
    let guess: EnvironmentIdentity["guess"] = "unknown";
    if (lower.includes("staging")) guess = "staging";
    else if (lower.includes("prod")) guess = "production";
    else if (["localhost", "127.0.0.1"].includes(url.hostname) && !lower.includes("staging") && !lower.includes("prod")) {
      guess = "local";
    }
    return { host: url.hostname, port: url.port || "5432", database, guess };
  } catch {
    return { host: "(unparseable)", port: "(unparseable)", database: "(unparseable)", guess: "unknown" };
  }
}
