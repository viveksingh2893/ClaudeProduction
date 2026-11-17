/**
 * The approval manifest — the ONLY input the apply step is allowed to act
 * on. Deliberately narrow: exact {entityType, id} pairs plus a per-record
 * content fingerprint, never a re-run of the broad name-matching search at
 * apply time (spec §6: "The actual deletion must operate only on those
 * reviewed IDs—not by rerunning a broad text search during deletion").
 */
import { createHash } from "node:crypto";
import type { Candidate } from "./types";
import { isDeletable } from "./types";

export type ManifestEntry = {
  entityType: Candidate["entityType"];
  id: string;
  name: string;
  /** SHA-256 of the record's identifying fields at manifest-generation time — recomputed and compared at apply time; any mismatch (or the record no longer existing) refuses the whole apply. */
  fingerprint: string;
};

export type Manifest = {
  generatedAt: string;
  environment: string;
  entries: ManifestEntry[];
  /** SHA-256 over the sorted list of entries — a whole-manifest integrity check, independent of the per-entry fingerprints (which catch DATA drift; this catches manifest-FILE tampering/corruption). */
  checksum: string;
};

function fingerprintOf(c: Candidate): string {
  const payload = JSON.stringify({
    id: c.id,
    entityType: c.entityType,
    name: c.name,
    email: c.email,
    sellerLabel: c.sellerLabel,
    matches: c.matches.map((m) => ({ field: m.field, value: m.value, rule: m.rule })),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function buildManifest(environment: string, allCandidates: Candidate[]): Manifest {
  const deletable = allCandidates.filter(isDeletable);
  const entries: ManifestEntry[] = deletable
    .map((c) => ({ entityType: c.entityType, id: c.id, name: c.name, fingerprint: fingerprintOf(c) }))
    .sort((a, b) => (a.entityType + a.id).localeCompare(b.entityType + b.id));

  const checksum = createHash("sha256")
    .update(JSON.stringify(entries.map((e) => [e.entityType, e.id, e.fingerprint])))
    .digest("hex");

  return { generatedAt: new Date().toISOString(), environment, entries, checksum };
}

export function verifyManifestChecksum(manifest: Manifest): boolean {
  const recomputed = createHash("sha256")
    .update(JSON.stringify(manifest.entries.map((e) => [e.entityType, e.id, e.fingerprint])))
    .digest("hex");
  return recomputed === manifest.checksum;
}

/**
 * Re-derives a fresh Candidate list's fingerprints and checks every
 * manifest entry still matches exactly — same id present, same
 * fingerprint (nothing about the record changed since the manifest was
 * built), and still deletable (not newly blocked by a dependency that
 * appeared since). Returns the specific problems found, empty = safe to
 * apply.
 */
export function diffManifestAgainstFresh(
  manifest: Manifest,
  freshCandidates: Candidate[],
): string[] {
  const problems: string[] = [];
  const freshById = new Map(freshCandidates.map((c) => [`${c.entityType}:${c.id}`, c]));

  for (const entry of manifest.entries) {
    const key = `${entry.entityType}:${entry.id}`;
    const fresh = freshById.get(key);
    if (!fresh) {
      problems.push(`${key} ("${entry.name}") no longer appears in a fresh scan — may already be deleted, or no longer matches.`);
      continue;
    }
    if (!isDeletable(fresh)) {
      problems.push(`${key} ("${entry.name}") is no longer deletable — ${fresh.blockReasons.join("; ") || (fresh.multiRole ? "now flagged multi-role" : "confidence dropped")}.`);
      continue;
    }
    const freshFingerprint = fingerprintOf(fresh);
    if (freshFingerprint !== entry.fingerprint) {
      problems.push(`${key} ("${entry.name}") changed since the manifest was generated — re-run a fresh dry run.`);
    }
  }
  return problems;
}
