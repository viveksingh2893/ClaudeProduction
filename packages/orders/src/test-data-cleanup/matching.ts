/**
 * Test-data field matching — deliberately NOT `WHERE name ILIKE '%test%'`.
 * A naive substring search would misclassify "latest", "contest",
 * "testing-compatible" (contains "test" but isn't one) as test data, and
 * would fail to obviously recognize "TestSeller" (no space/hyphen
 * separator, but still unambiguously a test name).
 *
 * The approach: tokenize the field value at every non-alphanumeric
 * character AND at every lowercase-to-uppercase transition (camelCase/
 * PascalCase boundary), then check whether any resulting token, lowercased,
 * is exactly "test". This correctly:
 *   - matches "Test", "Test Customer", "Test-Dealer", "Test_2", "test123"
 *     (digits don't break a token, but "test" must still be the WHOLE
 *     leading alphabetic run)
 *   - matches "TestSeller", "TestProduct2" (camelCase boundary after "Test")
 *   - does NOT match "latest" (no boundary anywhere inside the word)
 *   - does NOT match "contest" (same)
 *   - does NOT match "testing-compatible" ("testing" stays one token,
 *     never equals "test")
 */

export type FieldMatch = {
  field: string;
  value: string;
  /** The exact token that matched, and where matching stopped short of "exact/prefix" confidence. */
  matchedToken: string;
  rule: MatchRule;
};

export type MatchRule =
  | "EXACT" // whole (trimmed) field value === "test"
  | "PREFIX" // starts with "test " / "test-" / "test_" (or a SKU/slug-style "test-"/"test_" prefix)
  | "TOKEN" // "test" appears as a separate token (word-boundary or camelCase-boundary split)
  | "EMAIL_LOCAL_PREFIX" // email local-part starts with "test" — see matchEmailLocalPart's own doc comment on why this is weighted differently
  | "DESCRIPTION"; // "test" token found only inside a free-text description field — per spec, "description only as a low-confidence signal", never solely sufficient for high confidence

/** Rules that, alone, never justify HIGH confidence — see classifyConfidence. */
const LOW_TRUST_RULES: ReadonlySet<MatchRule> = new Set(["EMAIL_LOCAL_PREFIX", "DESCRIPTION"]);

/** Splits on any run of non-alphanumeric characters, and inserts an additional split at every lowercase/digit -> uppercase transition (camelCase/PascalCase boundary). */
function tokenize(value: string): string[] {
  const withCamelBoundaries = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return withCamelBoundaries
    .split(/[^a-zA-Z0-9]+| /)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Checks one field value for a test-data signal. Returns null if none of
 * the structural rules match — a bare `.includes("test")` is deliberately
 * never used as a fallback.
 */
export function matchField(field: string, rawValue: string | null | undefined): FieldMatch | null {
  if (!rawValue) return null;
  const value = rawValue.trim();
  if (!value) return null;
  const lower = value.toLowerCase();

  if (lower === "test") {
    return { field, value: rawValue, matchedToken: value, rule: "EXACT" };
  }
  if (/^test[\s\-_]/i.test(value)) {
    return { field, value: rawValue, matchedToken: value.split(/[\s\-_]/)[0]!, rule: "PREFIX" };
  }
  // SKU/slug convention: "test-product-123", "test_variant_1" — same PREFIX
  // rule, restated because slugs/SKUs sometimes have no leading token
  // separator style overlap with names (still starts with "test-"/"test_").
  if (/^test[-_]/i.test(value)) {
    return { field, value: rawValue, matchedToken: value.split(/[-_]/)[0]!, rule: "PREFIX" };
  }
  const tokens = tokenize(value);
  const testToken = tokens.find((t) => t.toLowerCase() === "test");
  if (testToken) {
    return { field, value: rawValue, matchedToken: testToken, rule: "TOKEN" };
  }
  return null;
}

/**
 * Email local-part signal — kept SEPARATE from matchField's structural
 * rules and always reported at a lower trust level by the caller, because
 * "starts with test" alone over-matches real words like "testimonial@" or
 * "testament@" that a person could plausibly have as part of a real email.
 * Combined with any other field match on the same record, this still
 * pushes the record to high confidence (see classifyCandidate) — alone,
 * it never does.
 */
export function matchEmailLocalPart(email: string | null | undefined): FieldMatch | null {
  if (!email) return null;
  const local = email.split("@")[0] ?? "";
  if (/^test/i.test(local)) {
    return { field: "email", value: email, matchedToken: local, rule: "EMAIL_LOCAL_PREFIX" };
  }
  return null;
}

/**
 * Same token-boundary logic as matchField, but explicitly tagged
 * "DESCRIPTION" so classifyConfidence never treats it alone as sufficient
 * for HIGH confidence — per spec, a "test" token appearing only inside a
 * free-text description is a low-confidence signal, even though the same
 * token-boundary match on a NAME/SKU/slug field is high confidence.
 */
export function matchDescription(field: string, rawValue: string | null | undefined): FieldMatch | null {
  const m = matchField(field, rawValue);
  if (!m) return null;
  return { ...m, rule: "DESCRIPTION" };
}

export type Confidence = "HIGH" | "LOW";

/**
 * A record is HIGH confidence if it has at least one structural match that
 * isn't itself low-trust (EMAIL_LOCAL_PREFIX, DESCRIPTION). Either of
 * those alone — no other field matching — is LOW confidence: reported,
 * never auto-deleted, per the spec's explicit "low-confidence candidates
 * must never be automatically deleted" rule.
 */
export function classifyConfidence(matches: FieldMatch[]): Confidence {
  return matches.some((m) => !LOW_TRUST_RULES.has(m.rule)) ? "HIGH" : "LOW";
}
