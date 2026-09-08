/**
 * Concession review AI — the deterministic half and the parsers.
 * Run: npx tsx src/lib/concessionReviewAi.selftest.ts
 */
import assert from "node:assert/strict";
import type { ConcessionGrant, ConcessionRule } from "./masters";
import {
  buildConcessionCaseFlags,
  buildConcessionCaseUserPrompt,
  buildConcessionClusters,
  buildConcessionPolicyUserPrompt,
  concessionGrantRoute,
  mobileKey,
  parseConcessionCaseJson,
  parseConcessionPolicyJson,
} from "./concessionReviewAi";

console.log("concessionReviewAi.selftest.ts");

const rule = (id: string, name: string, value: number, extra: Partial<ConcessionRule> = {}): ConcessionRule =>
  ({
    id,
    code: id.toUpperCase(),
    name,
    kind: "other",
    academicYearCode: "*",
    mode: "fixed",
    value,
    siblingTiers: [],
    feeHeadIds: [],
    autoApproveMaxPaise: null,
    documentationRequired: false,
    incompatibleCodes: [],
    notes: "",
    isActive: true,
    ...extra,
  }) as ConcessionRule;
const grant = (concessionId: string, studentId: string, extra: Partial<ConcessionGrant> = {}): ConcessionGrant =>
  ({
    id: `g_${concessionId}_${studentId}`,
    concessionId,
    studentId,
    status: "approved",
    ground: "",
    reason: "Fee Take · Counter concession · from Tuition Fee · April · receipt RCV-00096 [v:rcv_x]",
    effectiveFrom: "2026-04-01",
    effectiveTo: "2027-03-31",
    createdAt: "2026-04-01T00:00:00Z",
    siblingChildNo: null,
    ...extra,
  }) as ConcessionGrant;

/* ── clusters: same value + heads = one group, names vary ─────── */
{
  const rules = [
    rule("r1", "₹150 off (Rahul)", 15000),
    rule("r2", "Tuition 150", 15000),
    rule("r3", "Sibling 150", 15000, { kind: "sibling" }),
    rule("r4", "₹165 off", 16500),
    rule("r5", "Unused ten percent", 10, { mode: "percent" }),
  ];
  const grants = [
    grant("r1", "s1"),
    grant("r2", "s2", { ground: "sibling" }),
    grant("r3", "s3", { ground: "sibling" }),
    grant("r4", "s4"),
    grant("r4", "s4", { id: "dup" }), // two grants, one child
  ];
  const { clusters, unusedDefinitions } = buildConcessionClusters({ rules, grants });
  assert.equal(clusters.length, 2, "150 and 165 are two groups; the unused 10% is none");
  const c1 = clusters[0]!;
  assert.equal(c1.id, "c1");
  assert.equal(c1.valueLabel, "₹150 off");
  assert.equal(c1.definitions, 3, "three names, one discount");
  assert.equal(c1.grants, 3);
  assert.equal(c1.students, 3);
  assert.deepEqual(c1.kinds, ["other", "sibling"]);
  assert.deepEqual(c1.grounds, [{ ground: "sibling", count: 2 }]);
  assert.equal(c1.ungroundedGrants, 1);
  assert.equal(clusters[1]!.students, 1, "two grants to one child count once");
  assert.deepEqual(unusedDefinitions, ["Unused ten percent"]);
  const prompt = buildConcessionPolicyUserPrompt({
    schoolName: "BHB",
    asOf: "2026-09-08",
    totalDefinitions: 5,
    totalGrants: 5,
    totalStudents: 4,
    clusters,
    unusedDefinitions,
  });
  assert.match(prompt, /c1: ₹150 off on all heads/);
  assert.match(prompt, /without a ground: 1/);
}

/* ── policy parser: allow-listed ids, catalogue grounds, no digits ── */
{
  const ok = parseConcessionPolicyJson(
    '```json\n{"summary":"Most discounts are one tuition amount under several names.","proposals":[{"clusterId":"c1","name":"Sibling tuition discount","looksLike":"sibling","note":"All three names point the same way."},{"clusterId":"c9","name":"Ghost","looksLike":"merit","note":""},{"clusterId":"c2","name":"Flat tuition discount","looksLike":"maybe-hardship","note":"No ground recorded."}]}\n```',
    ["c1", "c2"],
  );
  assert.ok(ok);
  assert.equal(ok.proposals.length, 2, "unknown cluster dropped");
  assert.equal(ok.proposals[1]!.looksLike, "unknown", "a ground outside the catalogue becomes unknown");
  assert.equal(
    parseConcessionPolicyJson('{"summary":"ok","proposals":[{"clusterId":"c1","name":"150 rupee discount","looksLike":"sibling","note":""}]}', ["c1"]),
    null,
    "a digit in a proposed name discards the draft",
  );
  assert.equal(parseConcessionPolicyJson('{"summary":"ok","proposals":[]}', ["c1"]), null, "no proposals → no draft");
}

/* ── case file: routes, mobiles, flags ────────────────────────── */
{
  assert.equal(concessionGrantRoute("Fee Take · Counter concession · from Tuition Fee"), "counter");
  assert.equal(concessionGrantRoute("Imported from fee_discount_report.xlsx"), "import");
  assert.equal(concessionGrantRoute("Approved by principal after hardship letter"), "manual");
  assert.equal(mobileKey("+91 94519 38805"), "9451938805");
  assert.equal(mobileKey("38805"), "", "short numbers never match");

  const flags = buildConcessionCaseFlags({
    grants: [
      { policyName: "₹150 off", valueLabel: "₹150 off", headsLabel: "Tuition Fee", groundLabel: "Not recorded", route: "counter", effectiveFrom: "2026-04-01", effectiveTo: "2026-11-30", status: "approved" },
    ],
    siblings: [
      { name: "Riya", classLabel: "Class 3 A", discounts: "none" },
      { name: "Aman", classLabel: "Class 7 B", discounts: "₹250 off (Hardship)" },
    ],
    staffMatches: [{ staffName: "Sunita Devi", via: "guardian mobile = staff mobile" }],
    balancePaise: 420000,
    todayIso: "2026-09-08",
  });
  const codes = flags.map((f) => f.code);
  assert.deepEqual(codes, ["no_ground", "siblings_differ", "sibling_without", "staff_ward_match", "expiring_soon", "counter_route", "unpaid_balance"]);
  assert.match(flags.find((f) => f.code === "no_ground")!.detail, /No ground was recorded for any/);
  assert.match(flags.find((f) => f.code === "unpaid_balance")!.detail, /₹4,200/);

  // A fully grounded, consistent, paid-up case raises nothing.
  assert.deepEqual(
    buildConcessionCaseFlags({
      grants: [{ policyName: "Staff ward", valueLabel: "50% off", headsLabel: "all heads", groundLabel: "Staff ward", route: "manual", effectiveFrom: "2026-04-01", effectiveTo: "2027-03-31", status: "approved" }],
      siblings: [],
      staffMatches: [],
      balancePaise: 0,
      todayIso: "2026-09-08",
    }),
    [],
  );

  const user = buildConcessionCaseUserPrompt({
    schoolName: "BHB",
    asOf: "2026-09-08",
    student: { name: "Aarav", admissionNo: "BHB-1", classLabel: "Class 5 A" },
    grants: [],
    siblings: [],
    staffMatches: [],
    money: null,
    flags: [],
  });
  assert.match(user, /money is not available\. Do not comment/);
  assert.match(user, /Flags: none/);
}

/* ── case parser ──────────────────────────────────────────────── */
{
  const d = parseConcessionCaseJson(
    '{"question":"Was it intended that only one of the two children receives the tuition discount?","priority":["siblings_differ","no_ground","made_up"],"note":"Nobody recorded why."}',
    ["no_ground", "siblings_differ"],
  );
  assert.ok(d);
  assert.deepEqual(d.priority, ["siblings_differ", "no_ground"]);
  assert.equal(parseConcessionCaseJson('{"question":"Is the 150 rupee discount right?","priority":[],"note":""}', []), null, "digit → discarded");
  assert.equal(parseConcessionCaseJson("not json", []), null);
}

console.log("  ok");
