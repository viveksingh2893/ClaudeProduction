import type { Candidate } from "./types";
import { isDeletable } from "./types";

export type ReportGroups = {
  testCustomers: Candidate[];
  testDealers: Candidate[];
  testSellers: Candidate[];
  testProductsOwnedByTestSellers: Candidate[];
  independentTestProductsOwnedByRealSellers: Candidate[];
  testVariants: Candidate[];
  highConfidence: Candidate[];
  lowConfidence: Candidate[];
  ambiguous: Candidate[]; // matched + would otherwise be high-confidence, but blocked/multiRole/data-integrity issue
  linkedToRealData: Candidate[];
};

export function groupReport(all: {
  customers: Candidate[];
  dealers: Candidate[];
  sellers: Candidate[];
  productsOwnedByTestSellers: Candidate[];
  independentProducts: Candidate[]; // from the by-name search, already excludes the owned-by-test-seller set by caller
  variants: Candidate[];
}): ReportGroups {
  const everything = [
    ...all.customers,
    ...all.dealers,
    ...all.sellers,
    ...all.productsOwnedByTestSellers,
    ...all.independentProducts,
    ...all.variants,
  ];

  return {
    testCustomers: all.customers,
    testDealers: all.dealers,
    testSellers: all.sellers,
    testProductsOwnedByTestSellers: all.productsOwnedByTestSellers,
    independentTestProductsOwnedByRealSellers: all.independentProducts.filter((p) => !p.ownerIsTestSeller),
    testVariants: all.variants,
    highConfidence: everything.filter((c) => c.confidence === "HIGH"),
    lowConfidence: everything.filter((c) => c.confidence === "LOW"),
    ambiguous: everything.filter(
      (c) => c.confidence === "HIGH" && (c.multiRole || c.blockReasons.length > 0),
    ),
    linkedToRealData: everything.filter((c) => c.linkedToApparentlyRealData),
  };
}

function fmtMatches(c: Candidate): string {
  if (c.matches.length === 0) return "(owned by a confirmed test seller — see §4/§9)";
  return c.matches
    .map((m) => `${m.field}="${m.value}" (${m.rule})`)
    .join("; ");
}

function fmtDependents(c: Candidate): string {
  if (c.dependents.length === 0) return "none";
  return c.dependents.map((d) => `${d.table}=${d.count}`).join(", ");
}

function printCandidate(c: Candidate): void {
  const deletable = isDeletable(c);
  const tag = deletable ? "[DELETABLE]" : c.blockReasons.length > 0 ? "[BLOCKED]" : c.multiRole ? "[MULTI-ROLE]" : "[LOW-CONFIDENCE]";
  console.log(`${tag} ${c.entityType} ${c.id} — "${c.name}"`);
  if (c.email) console.log(`    email: ${c.email}`);
  if (c.role) console.log(`    role: ${c.role}`);
  if (c.sellerLabel) console.log(`    seller/store: ${c.sellerLabel}`);
  console.log(`    matched: ${fmtMatches(c)}`);
  console.log(`    confidence: ${c.confidence}`);
  console.log(`    created: ${c.createdAt.toISOString()}`);
  console.log(`    dependents: ${fmtDependents(c)}`);
  if (c.multiRole) console.log(`    ⚠ has more than one profile relation populated — needs manual review, never auto-deleted`);
  if (c.linkedToApparentlyRealData) console.log(`    ⚠ linked to apparently real data: ${c.linkedToApparentlyRealDataDetail}`);
  for (const reason of c.blockReasons) console.log(`    ⛔ ${reason}`);
  console.log("");
}

export function printReport(groups: ReportGroups): void {
  const section = (title: string, items: Candidate[]) => {
    console.log(`\n=== ${title} (${items.length}) ===\n`);
    if (items.length === 0) {
      console.log("(none)\n");
      return;
    }
    for (const c of items) printCandidate(c);
  };

  section("1. Test customers", groups.testCustomers);
  section("2. Test dealers", groups.testDealers);
  section("3. Test sellers", groups.testSellers);
  section("4. Test products owned by test sellers", groups.testProductsOwnedByTestSellers);
  section("5. Independently matched test products owned by non-test sellers", groups.independentTestProductsOwnedByRealSellers);
  section("6. Test variants", groups.testVariants);
  section("7. High-confidence candidates (cross-cutting summary)", groups.highConfidence);
  section("8. Low-confidence candidates — never auto-deleted, manual review only", groups.lowConfidence);
  section("9. Ambiguous candidates (blocked, multi-role, or data-integrity issue)", groups.ambiguous);
  section("10. Candidates linked to apparently real records", groups.linkedToRealData);

  const deletableCount = (items: Candidate[]) => items.filter(isDeletable).length;
  console.log("\n=== Totals ===\n");
  console.log(`  Test customers:            ${groups.testCustomers.length} (${deletableCount(groups.testCustomers)} deletable)`);
  console.log(`  Test dealers:              ${groups.testDealers.length} (${deletableCount(groups.testDealers)} deletable)`);
  console.log(`  Test sellers:              ${groups.testSellers.length} (${deletableCount(groups.testSellers)} deletable)`);
  console.log(`  Test products (test-seller owned): ${groups.testProductsOwnedByTestSellers.length} (${deletableCount(groups.testProductsOwnedByTestSellers)} deletable)`);
  console.log(`  Test products (independent):       ${groups.independentTestProductsOwnedByRealSellers.length} (${deletableCount(groups.independentTestProductsOwnedByRealSellers)} deletable)`);
  console.log(`  Test variants:             ${groups.testVariants.length} (${deletableCount(groups.testVariants)} deletable)`);
  console.log(`  High confidence total:     ${groups.highConfidence.length}`);
  console.log(`  Low confidence total:      ${groups.lowConfidence.length}`);
  console.log(`  Ambiguous/blocked total:   ${groups.ambiguous.length}`);
  console.log(`  Linked to real data total: ${groups.linkedToRealData.length}`);
}
