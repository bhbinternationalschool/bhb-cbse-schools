/**
 * Reviewing concessions with AI — the two features the data can honestly
 * support (docs/CONCESSION_REVIEW_AI_PLAN.md).
 *
 * A. THE POLICY DRAFT. The school has more ways of giving a discount than
 *    children receiving one (171 definitions for 149 grants on 2026-09-08):
 *    "₹150 off", "₹165 off", "₹190 off", each its own record, most tagged
 *    `other`. Deterministic code groups the definitions that are the same
 *    discount under different names; the model proposes what each group is
 *    called and which ground it appears to serve. A DRAFT for a human to
 *    approve — nothing here merges, renames or deletes a policy.
 *
 * B. THE CASE FILE. For one child holding a concession, code assembles what
 *    the school DOES know — the discounts, how each was granted, the other
 *    children of the household and their discounts, whether a guardian is on
 *    the staff roster, what has been paid this session — and raises flags by
 *    rule. The model's only job is to write the reviewer's QUESTION, by flag
 *    code. Where no ground was recorded, the case file says so and stops.
 *
 * Two rules, both stricter than "be careful":
 *   - the model never writes a digit: every amount, count and date is already
 *     rendered beside its words, and a plausible wrong number about a family's
 *     money is worse than none;
 *   - the model never names a ground the school did not record. It may say a
 *     group LOOKS LIKE a sibling discount (from the names it was given); it may
 *     not say a family HAS one.
 *
 * Pure and client-safe: facts types, deterministic builders, prompts, parsers.
 * The LLM call lives in aiLlm.server.ts; the data gathering in the routes.
 */

import type {
  ConcessionGrant,
  ConcessionGround,
  ConcessionRule,
  MastersState,
} from "@/lib/masters";
import { CONCESSION_GROUNDS, formatInr } from "@/lib/masters";

export type ConcessionReviewLanguage = "en" | "hi";

const CONTAINS_DIGIT = /\d/;

function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
}

/* ────────────────────────────────────────────────────────────────────────
 * A. Policy consolidation
 * ──────────────────────────────────────────────────────────────────────── */

export type ConcessionCluster = {
  /** Stable id the model must refer to: `c1`, `c2`, … in size order. */
  id: string;
  /**
   * The definitions themselves, most-granted first.
   *
   * The group is useless as a finding alone — the office cannot act on "these
   * thirty-six are the same discount" without the ids of the thirty-six. This
   * is what the merge works on, and what lets a proposal be matched back to a
   * group after the list is rebuilt from a different copy of masters.
   */
  ruleIds: string[];
  /** What the definitions have in common, rendered ("₹150 off", "10%", "sibling tiers …"). */
  valueLabel: string;
  /** Fee heads the discount applies to; "all heads" when unrestricted. */
  headsLabel: string;
  /** Distinct kind codes the definitions carry (`other`, `hardship`, …). */
  kinds: string[];
  /** Every definition name in the group, most used first. */
  names: string[];
  definitions: number;
  grants: number;
  students: number;
  /** Recorded grounds across the group's approved grants, most common first. */
  grounds: { ground: string; count: number }[];
  /** Grants with no recorded ground at all. */
  ungroundedGrants: number;
};

export type ConcessionPolicyFacts = {
  schoolName: string;
  asOf: string;
  totalDefinitions: number;
  totalGrants: number;
  totalStudents: number;
  clusters: ConcessionCluster[];
  /** Definitions with no approved grant at all — candidates to retire. */
  unusedDefinitions: string[];
};

export type ConcessionPolicyProposal = {
  clusterId: string;
  /** Proposed policy name. Words only — the value label is shown beside it. */
  name: string;
  /** A ground id from CONCESSION_GROUNDS, or "unknown". Never invented. */
  looksLike: string;
  /** One sentence on why these belong together, or what is unclear. */
  note: string;
};

export type ConcessionPolicyDraft = {
  /** One or two sentences on the overall shape. No digits. */
  summary: string;
  proposals: ConcessionPolicyProposal[];
};

export const CONCESSION_POLICY_PROMPT_VERSION = "v1";

function ruleValueKey(rule: ConcessionRule): string {
  if (rule.kind === "sibling" && (rule.siblingTiers?.length ?? 0) > 0) {
    const tiers = [...rule.siblingTiers]
      .sort((a, b) => a.childNo - b.childNo)
      .map((t) => `${t.childNo}:${t.mode}:${t.value}`)
      .join(",");
    return `sib|${tiers}`;
  }
  return `${rule.mode}|${rule.value}`;
}

function ruleValueLabel(rule: ConcessionRule): string {
  if (rule.kind === "sibling" && (rule.siblingTiers?.length ?? 0) > 0) {
    return [...rule.siblingTiers]
      .sort((a, b) => a.childNo - b.childNo)
      .map((t) => `child ${t.childNo}: ${t.mode === "percent" ? `${t.value}%` : `${formatInr(t.value)} off`}`)
      .join(" · ");
  }
  return rule.mode === "percent" ? `${rule.value}% off` : `${formatInr(rule.value)} off`;
}

function headsKey(rule: ConcessionRule): string {
  return [...new Set(rule.feeHeadIds ?? [])].sort().join(",");
}

/**
 * Group definitions that are the same discount: same value, same heads.
 * Names and kinds are NOT part of the key — they are exactly what varies
 * between "₹150 off (Rahul)", "Tuition 150" and "Sibling 150" — and the
 * whole point is to show that those three are one policy.
 */
export function buildConcessionClusters(input: {
  rules: ConcessionRule[];
  grants: ConcessionGrant[];
  feeHeadName?: (id: string) => string;
}): { clusters: ConcessionCluster[]; unusedDefinitions: string[] } {
  const approved = input.grants.filter((g) => g.status === "approved");
  const grantsByRule = new Map<string, ConcessionGrant[]>();
  for (const g of approved) {
    grantsByRule.set(g.concessionId, [...(grantsByRule.get(g.concessionId) ?? []), g]);
  }
  const byKey = new Map<string, ConcessionRule[]>();
  for (const r of input.rules) {
    const key = `${ruleValueKey(r)}|${headsKey(r)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const unusedDefinitions: string[] = [];
  const raw: Omit<ConcessionCluster, "id">[] = [];
  for (const rules of byKey.values()) {
    const grants = rules.flatMap((r) => grantsByRule.get(r.id) ?? []);
    for (const r of rules) {
      if (!(grantsByRule.get(r.id) ?? []).length) unusedDefinitions.push(r.name || r.code);
    }
    if (!grants.length) continue;
    const sample = rules[0]!;
    const nameCount = new Map<string, number>();
    for (const r of rules) {
      const n = (r.name || r.code).trim();
      nameCount.set(n, (nameCount.get(n) ?? 0) + (grantsByRule.get(r.id)?.length ?? 0) + 1);
    }
    const groundCount = new Map<string, number>();
    let ungrounded = 0;
    for (const g of grants) {
      if (!g.ground) {
        ungrounded += 1;
        continue;
      }
      groundCount.set(g.ground, (groundCount.get(g.ground) ?? 0) + 1);
    }
    const heads = [...new Set(sample.feeHeadIds ?? [])];
    raw.push({
      ruleIds: [...rules]
        .sort(
          (a, b) =>
            (grantsByRule.get(b.id)?.length ?? 0) -
            (grantsByRule.get(a.id)?.length ?? 0),
        )
        .map((r) => r.id),
      valueLabel: ruleValueLabel(sample),
      headsLabel: heads.length
        ? heads.map((h) => (input.feeHeadName ? input.feeHeadName(h) : h)).join(", ")
        : "all heads",
      kinds: [...new Set(rules.map((r) => r.kind || "other"))].sort(),
      names: [...nameCount.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
      definitions: rules.length,
      grants: grants.length,
      students: new Set(grants.map((g) => g.studentId)).size,
      grounds: [...groundCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([ground, count]) => ({ ground, count })),
      ungroundedGrants: ungrounded,
    });
  }
  raw.sort((a, b) => b.grants - a.grants || b.definitions - a.definitions);
  return {
    clusters: raw.map((c, i) => ({ id: `c${i + 1}`, ...c })),
    unusedDefinitions: unusedDefinitions.sort(),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * A2. Making the group real
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * What the office asked for after seeing the groups: not a paragraph about
 * thirty-six definitions of "₹150 off tuition", but one discount with a name
 * and the children under it.
 *
 * The merge keeps ONE definition (the keeper), points the chosen grants at
 * it, and drops the definitions that are then empty. Two things it must never
 * do, both enforced below rather than trusted to the caller:
 *
 *   - change what anybody is charged. Every definition folded in must take
 *     the same amount off the same heads as the keeper, and the keeper's
 *     value and heads are not touched. A merge that cannot prove that is
 *     refused, not "mostly applied";
 *   - remove a definition something still points at. A definition still
 *     holding a grant stays; so does one the bundled discount import refers
 *     to by code, because that import re-materialises the rule at read time
 *     and a child with no persisted grant depends on it being there.
 */
export type ConcessionMergePlan = {
  /** The definition that survives and gets the name. */
  keeperRuleId: string;
  /** The policy name the office decides on. */
  name: string;
  /** New code for the keeper. Omit to keep the one it has. */
  code?: string;
  /** Every definition in the group, keeper included. */
  ruleIds: string[];
  /** Grants to move onto the keeper. */
  grantIds: string[];
  /** Recorded on moved grants that have NO ground. Never overwrites one. */
  ground?: ConcessionGround | "";
  /** Codes the bundled discount import still refers to — never removed. */
  protectedCodes?: string[];
  /** ISO date for the audit line on the keeper. */
  today: string;
};

export type ConcessionMergeOutcome = {
  state: MastersState;
  keeperName: string;
  keeperCode: string;
  movedGrants: number;
  groundsRecorded: number;
  /** Definition names removed from masters. */
  removedDefinitions: string[];
  /** Definitions left standing, with why. */
  keptDefinitions: { name: string; why: "still granted" | "used by the import" }[];
};

function sameDiscount(a: ConcessionRule, b: ConcessionRule): boolean {
  return (
    ruleValueKey(a) === ruleValueKey(b) && headsKey(a) === headsKey(b)
  );
}

export function applyConcessionMerge(
  state: MastersState,
  plan: ConcessionMergePlan,
): { ok: true; outcome: ConcessionMergeOutcome } | { ok: false; reason: string } {
  const rules = state.concessions ?? [];
  const keeper = rules.find((r) => r.id === plan.keeperRuleId);
  if (!keeper) return { ok: false, reason: "The definition to keep no longer exists — reload and try again." };
  const name = plan.name.trim();
  if (!name) return { ok: false, reason: "Give the discount a name first." };

  const groupIds = new Set(plan.ruleIds);
  groupIds.add(keeper.id);
  const group = rules.filter((r) => groupIds.has(r.id));
  const odd = group.find((r) => !sameDiscount(r, keeper));
  if (odd) {
    return {
      ok: false,
      reason: `“${odd.name || odd.code}” does not take the same amount off the same heads as “${keeper.name || keeper.code}”. Merging it would change what a family is charged.`,
    };
  }

  const code = (plan.code ?? keeper.code).trim().toUpperCase();
  if (!code) return { ok: false, reason: "A discount needs a code." };
  const protectedCodes = new Set(
    (plan.protectedCodes ?? []).map((c) => c.trim().toUpperCase()),
  );
  // Renaming the code of a definition the import points at does not free the
  // code: the import re-creates the missing rule the next time anything reads
  // masters, and the office is back to two definitions instead of one.
  if (
    code !== keeper.code.trim().toUpperCase() &&
    protectedCodes.has(keeper.code.trim().toUpperCase())
  ) {
    return {
      ok: false,
      reason: `Code ${keeper.code.toUpperCase()} comes from the discount import and cannot be changed — the import would recreate it. Keep this code, or merge into one of the other definitions instead.`,
    };
  }
  const clash = rules.find(
    (r) => !groupIds.has(r.id) && r.code.trim().toUpperCase() === code,
  );
  if (clash) {
    return {
      ok: false,
      reason: `Code ${code} already belongs to “${clash.name || clash.code}”. Pick another.`,
    };
  }

  const moveIds = new Set(plan.grantIds);
  const ground = plan.ground || "";
  let movedGrants = 0;
  let groundsRecorded = 0;
  const grants = (state.concessionGrants ?? []).map((g) => {
    if (!moveIds.has(g.id) || !groupIds.has(g.concessionId)) return g;
    const next: ConcessionGrant = { ...g };
    if (next.concessionId !== keeper.id) {
      next.concessionId = keeper.id;
      movedGrants += 1;
    }
    if (ground && !next.ground) {
      next.ground = ground;
      groundsRecorded += 1;
    }
    return next;
  });

  // Which definitions may now go. A grant of ANY status still pointing at one
  // holds it back — a pending grant is not a spare row.
  const stillGranted = new Set(grants.map((g) => g.concessionId));
  const removedDefinitions: string[] = [];
  const keptDefinitions: ConcessionMergeOutcome["keptDefinitions"] = [];
  const removeIds = new Set<string>();
  for (const r of group) {
    if (r.id === keeper.id) continue;
    const label = r.name || r.code;
    if (stillGranted.has(r.id)) {
      keptDefinitions.push({ name: label, why: "still granted" });
      continue;
    }
    if (protectedCodes.has(r.code.trim().toUpperCase())) {
      keptDefinitions.push({ name: label, why: "used by the import" });
      continue;
    }
    removeIds.add(r.id);
    removedDefinitions.push(label);
  }

  const auditLine = `Merged ${removedDefinitions.length + 1} definition(s) into one on ${plan.today}`;
  const nextRules = rules
    .filter((r) => !removeIds.has(r.id))
    .map((r) =>
      r.id === keeper.id
        ? {
            ...r,
            name,
            code,
            notes: r.notes.includes(auditLine)
              ? r.notes
              : [r.notes.trim(), auditLine].filter(Boolean).join(" · "),
          }
        : r,
    );

  return {
    ok: true,
    outcome: {
      state: { ...state, concessions: nextRules, concessionGrants: grants },
      keeperName: name,
      keeperCode: code,
      movedGrants,
      groundsRecorded,
      removedDefinitions,
      keptDefinitions,
    },
  };
}

/**
 * Which live group a model proposal belongs to.
 *
 * Proposals come back keyed by `c1`, `c2` — positions in the list the server
 * built. The browser rebuilds the same list from its own copy of masters, and
 * one extra grant between the two is enough to reorder it. Matching on shared
 * definition ids instead of position means a name can only ever land on the
 * group it was written about, and lands nowhere if that group is gone.
 */
export function matchClusterProposals<T extends { clusterId: string }>(
  liveClusters: readonly ConcessionCluster[],
  sourceClusters: readonly ConcessionCluster[],
  proposals: readonly T[],
): Map<string, T> {
  const byId = new Map(sourceClusters.map((c) => [c.id, c]));
  const out = new Map<string, T>();
  for (const live of liveClusters) {
    const mine = new Set(live.ruleIds);
    let best: { p: T; overlap: number } | null = null;
    for (const p of proposals) {
      const source = byId.get(p.clusterId);
      if (!source) continue;
      const overlap = source.ruleIds.filter((id) => mine.has(id)).length;
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { p, overlap };
    }
    if (best) out.set(live.id, best.p);
  }
  return out;
}

export function buildConcessionPolicySystemPrompt(opts: {
  language: ConcessionReviewLanguage;
  schoolName: string;
}): string {
  const lang = opts.language === "hi" ? "Write in simple Hindi (Devanagari)." : "Write in plain English.";
  const grounds = CONCESSION_GROUNDS.map((g) => `${g.id} (${g.label})`).join(", ");
  return [
    `You help the director of ${opts.schoolName} turn a long list of individual fee discounts into a short, consistent concession policy.`,
    lang,
    "",
    "You are given GROUPS of discount definitions that code has already found to be the",
    "same discount (same amount, same fee heads) under different names, with how many",
    "children receive each and which grounds, if any, were recorded when they were granted.",
    "",
    "For each group, propose ONE policy name and say which ground it LOOKS LIKE it serves,",
    "judging only from the names and recorded grounds you are given.",
    "",
    "ABSOLUTE RULES:",
    "1. NEVER write a digit. Amounts and counts are shown to the reader beside your words.",
    "   A proposed name must be words only — e.g. 'Sibling tuition discount', not '₹150 off'.",
    `2. looksLike must be one of: ${grounds}, or the word unknown. When the names and`,
    "   recorded grounds do not point clearly at one ground, say unknown. Do not guess.",
    "3. Refer to groups only by the ids supplied. Do not invent a group.",
    "4. This is a draft for a human to approve. Do not instruct anyone to change, merge or",
    "   remove anything; describe what the groups appear to be.",
    "",
    'Reply with JSON only: {"summary":"...","proposals":[{"clusterId":"c1","name":"...","looksLike":"sibling","note":"..."}]}',
    "summary: at most two sentences. note: one sentence each.",
  ].join("\n");
}

export function buildConcessionPolicyUserPrompt(f: ConcessionPolicyFacts): string {
  const lines: string[] = [
    `As at: ${f.asOf}`,
    `Definitions in total: ${f.totalDefinitions} · approved grants: ${f.totalGrants} · children: ${f.totalStudents}`,
    "",
    "Groups (refer to these by id only):",
  ];
  for (const c of f.clusters) {
    const grounds = c.grounds.length
      ? c.grounds.map((g) => `${g.ground}×${g.count}`).join(", ")
      : "none recorded";
    lines.push(
      `- ${c.id}: ${c.valueLabel} on ${c.headsLabel} · ${c.definitions} definition(s) · ${c.grants} grant(s) · ${c.students} child(ren)`,
      `    names: ${c.names.slice(0, 8).join(" | ")}${c.names.length > 8 ? " | …" : ""}`,
      `    kinds tagged: ${c.kinds.join(", ")} · grounds recorded: ${grounds} · without a ground: ${c.ungroundedGrants}`,
    );
  }
  if (f.unusedDefinitions.length) {
    lines.push("", `Definitions with no approved grant (not in any group): ${f.unusedDefinitions.length}.`);
  }
  return lines.join("\n");
}

export function parseConcessionPolicyJson(
  text: string,
  allowedClusterIds: string[],
): ConcessionPolicyDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary || CONTAINS_DIGIT.test(summary)) return null;
  const allowed = new Set(allowedClusterIds);
  const groundIds = new Set<string>(CONCESSION_GROUNDS.map((g) => g.id));
  const seen = new Set<string>();
  const proposals: ConcessionPolicyProposal[] = [];
  for (const p of Array.isArray(o.proposals) ? o.proposals : []) {
    if (!p || typeof p !== "object") continue;
    const q = p as Record<string, unknown>;
    const clusterId = typeof q.clusterId === "string" ? q.clusterId.trim() : "";
    const name = typeof q.name === "string" ? q.name.trim() : "";
    const note = typeof q.note === "string" ? q.note.trim() : "";
    const looksLikeRaw = typeof q.looksLike === "string" ? q.looksLike.trim().toLowerCase() : "unknown";
    if (!allowed.has(clusterId) || seen.has(clusterId) || !name) continue;
    // A digit in a name or note is a figure the model made up — the draft
    // is discarded rather than scrubbed, same as the ledger brief.
    if (CONTAINS_DIGIT.test(name) || CONTAINS_DIGIT.test(note)) return null;
    seen.add(clusterId);
    proposals.push({
      clusterId,
      name,
      looksLike: groundIds.has(looksLikeRaw) ? looksLikeRaw : "unknown",
      note,
    });
  }
  if (!proposals.length) return null;
  return { summary, proposals };
}

/* ────────────────────────────────────────────────────────────────────────
 * B. The case file
 * ──────────────────────────────────────────────────────────────────────── */

export type ConcessionCaseFlagCode =
  | "no_ground"
  | "siblings_differ"
  | "sibling_without"
  | "staff_ward_match"
  | "expiring_soon"
  | "counter_route"
  | "imported"
  | "unpaid_balance";

export type ConcessionCaseFlag = {
  code: ConcessionCaseFlagCode;
  /** Rendered by rule, amounts included — what the reviewer reads. */
  detail: string;
};

export type ConcessionCaseGrant = {
  policyName: string;
  valueLabel: string;
  headsLabel: string;
  /** Recorded ground label, or "Not recorded". */
  groundLabel: string;
  /** How it came to exist — counter | import | manual — from the reason text. */
  route: "counter" | "import" | "manual";
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
};

export type ConcessionCaseSibling = {
  name: string;
  classLabel: string;
  /** Rendered discounts, or "none". */
  discounts: string;
};

export type ConcessionCaseFacts = {
  schoolName: string;
  asOf: string;
  student: { name: string; admissionNo: string; classLabel: string };
  grants: ConcessionCaseGrant[];
  siblings: ConcessionCaseSibling[];
  /** Staff on the roster sharing a guardian mobile; empty = no match. */
  staffMatches: { staffName: string; via: string }[];
  /** This session's money, rendered; null when the dues could not be read. */
  money: { billed: string; concession: string; paid: string; balance: string } | null;
  flags: ConcessionCaseFlag[];
};

export type ConcessionCaseDraft = {
  /** The one question the reviewer should settle. No digits. */
  question: string;
  /** Flag codes in the order they matter. Allow-listed. */
  priority: ConcessionCaseFlagCode[];
  /** Up to two sentences of context. No digits. */
  note: string;
};

export const CONCESSION_CASE_PROMPT_VERSION = "v1";

export function concessionGrantRoute(reason: string): ConcessionCaseGrant["route"] {
  const r = (reason || "").toLowerCase();
  if (/fee take|counter concession|receipt /.test(r)) return "counter";
  if (/import|xlsx|excel|fee_discount_report/.test(r)) return "import";
  return "manual";
}

/** Digits stripped to the last ten — how every mobile is compared here. */
export function mobileKey(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/**
 * Raise the flags. Deterministic; the model reads these and nothing else.
 * The thresholds are deliberately plain (a discount expiring inside four
 * months, a balance above nil) so a reviewer can predict what will be raised.
 */
export function buildConcessionCaseFlags(input: {
  grants: ConcessionCaseGrant[];
  siblings: ConcessionCaseSibling[];
  staffMatches: ConcessionCaseFacts["staffMatches"];
  balancePaise: number | null;
  todayIso: string;
}): ConcessionCaseFlag[] {
  const flags: ConcessionCaseFlag[] = [];
  const noGround = input.grants.filter((g) => g.groundLabel === "Not recorded");
  if (noGround.length) {
    flags.push({
      code: "no_ground",
      detail:
        noGround.length === input.grants.length
          ? "No ground was recorded for any of this child's concessions."
          : `${noGround.length} of ${input.grants.length} concessions have no recorded ground.`,
    });
  }
  const mine = input.grants.map((g) => `${g.valueLabel} (${g.policyName})`).sort().join("; ") || "none";
  const withOther = input.siblings.filter((s) => s.discounts !== "none" && s.discounts !== mine);
  const without = input.siblings.filter((s) => s.discounts === "none");
  if (withOther.length) {
    flags.push({
      code: "siblings_differ",
      detail: `Sibling discounts differ: ${withOther.map((s) => `${s.name} (${s.classLabel}) has ${s.discounts}`).join("; ")}; this child has ${mine}.`,
    });
  }
  if (without.length && input.grants.length) {
    flags.push({
      code: "sibling_without",
      detail: `${without.map((s) => `${s.name} (${s.classLabel})`).join(", ")} in the same household ${without.length === 1 ? "has" : "have"} no concession.`,
    });
  }
  if (input.staffMatches.length) {
    flags.push({
      code: "staff_ward_match",
      detail: `A guardian mobile matches staff on the roster: ${input.staffMatches.map((m) => `${m.staffName} (${m.via})`).join("; ")}. No concession is recorded as a staff-ward ground.`,
    });
  }
  const soon = new Date(input.todayIso);
  soon.setDate(soon.getDate() + 120);
  const expiring = input.grants.filter(
    (g) => g.effectiveTo && g.effectiveTo >= input.todayIso && g.effectiveTo <= soon.toISOString().slice(0, 10),
  );
  if (expiring.length) {
    flags.push({
      code: "expiring_soon",
      detail: `${expiring.length} concession(s) end by ${expiring.map((g) => g.effectiveTo).sort().pop()}; a renewal decision is due.`,
    });
  }
  if (input.grants.some((g) => g.route === "counter")) {
    flags.push({ code: "counter_route", detail: "At least one concession was given at the fee counter during a payment, not from a policy." });
  }
  if (input.grants.some((g) => g.route === "import")) {
    flags.push({ code: "imported", detail: "At least one concession came from the old-ERP discount import; its ground was never captured." });
  }
  if (input.balancePaise != null && input.balancePaise > 0) {
    flags.push({ code: "unpaid_balance", detail: `The family still owes ${formatInr(input.balancePaise)} this session despite the concession.` });
  }
  return flags;
}

export function buildConcessionCaseSystemPrompt(opts: {
  language: ConcessionReviewLanguage;
  schoolName: string;
}): string {
  const lang = opts.language === "hi" ? "Write in simple Hindi (Devanagari)." : "Write in plain English.";
  return [
    `You help the principal of ${opts.schoolName} review one child's fee concession.`,
    lang,
    "",
    "You are given the case file — the discounts, how each was granted, the other children",
    "of the household, any staff match, this session's money — and a list of FLAGS that",
    "code has already raised. Your only job is to write the one question the reviewer",
    "should settle, and say which flags matter most.",
    "",
    "ABSOLUTE RULES:",
    "1. NEVER write a digit. Every amount, count and date is shown to the reader beside your words.",
    "2. Never state why the family qualifies for a discount. Where a ground is 'Not recorded',",
    "   the honest finding is that nobody wrote it down — say that, and do not supply one.",
    "3. Refer to flags only by the codes supplied. Do not invent a flag or a fact.",
    "4. Do not judge the family's need, honesty or likelihood to pay. Ask; do not conclude.",
    "5. If there are no flags, say plainly that nothing needs the reviewer's attention.",
    "",
    'Reply with JSON only: {"question":"...","priority":["code",...],"note":"..."}',
    "question: one sentence ending in a question mark. note: at most two sentences.",
  ].join("\n");
}

export function buildConcessionCaseUserPrompt(f: ConcessionCaseFacts): string {
  const lines: string[] = [
    `As at: ${f.asOf}`,
    `Child: ${f.student.name}, ${f.student.classLabel}, admission ${f.student.admissionNo}`,
    "",
    "Concessions held:",
  ];
  for (const g of f.grants) {
    lines.push(
      `- ${g.policyName}: ${g.valueLabel} on ${g.headsLabel} · ground: ${g.groundLabel} · given via ${g.route} · from ${g.effectiveFrom}${g.effectiveTo ? ` to ${g.effectiveTo}` : ""} · ${g.status}`,
    );
  }
  lines.push("", f.siblings.length ? "Other children of the household:" : "Other children of the household: none in school.");
  for (const s of f.siblings) lines.push(`- ${s.name} (${s.classLabel}): ${s.discounts}`);
  lines.push(
    "",
    f.staffMatches.length
      ? `Staff roster match: ${f.staffMatches.map((m) => `${m.staffName} via ${m.via}`).join("; ")}`
      : "Staff roster match: none.",
    "",
    f.money
      ? `This session (already computed, shown to the reader): billed ${f.money.billed}, concession ${f.money.concession}, paid ${f.money.paid}, balance ${f.money.balance}.`
      : "This session's money is not available. Do not comment on payment.",
    "",
  );
  if (!f.flags.length) lines.push("Flags: none.");
  else {
    lines.push("Flags (refer to these by code only):");
    for (const x of f.flags) lines.push(`- ${x.code}: ${x.detail}`);
  }
  return lines.join("\n");
}

export function parseConcessionCaseJson(
  text: string,
  allowedCodes: string[],
): ConcessionCaseDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const question = typeof o.question === "string" ? o.question.trim() : "";
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (!question) return null;
  if (CONTAINS_DIGIT.test(question) || CONTAINS_DIGIT.test(note)) return null;
  const allowed = new Set(allowedCodes);
  const priority = Array.isArray(o.priority)
    ? o.priority
        .map((c) => (typeof c === "string" ? c.trim() : ""))
        .filter((c): c is ConcessionCaseFlagCode => !!c && allowed.has(c))
    : [];
  return { question, priority: [...new Set(priority)], note };
}
