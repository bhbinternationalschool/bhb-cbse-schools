/**
 * Referral rewards — turning "a parent brought us a family" into a real
 * discount on that parent's own ward's fees.
 *
 * The school sets ONE policy (when a referral counts, how much, on which
 * head, for how long, capped at how many). Awarding then creates an ordinary
 * Masters concession grant on the referrer's ward, so every existing rule
 * applies to it: it shows on the fee line, it can be edited or stopped in
 * Masters → Concessions, and it survives promotion like any other grant.
 *
 * Deliberately NOT automatic on its own: the office presses Award (or runs
 * "award all due"), because a discount on money owed to the school should
 * have a person behind it. The policy decides the amount; the office
 * decides the moment.
 */

import type { AdmissionLead } from "@/lib/admissions";
import {
  computeStudentDues,
  loadFees,
  type FeeDueLine,
} from "@/lib/fees";
import {
  DEFAULT_AY,
  formatInr,
  loadMasters,
  newId,
  normalizeConcessionGrant,
  normalizeConcessionRule,
  saveMasters,
  type ConcessionGrant,
  type ConcessionRule,
  type MastersState,
} from "@/lib/masters";
import { loadReferrals, referralCodeFor, saveReferrals } from "@/lib/referrals";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";

export type ReferralTrigger =
  | "enquiry"
  | "registered"
  | "enrolled"
  | "paid_first_month";

export type ReferralRewardPolicy = {
  enabled: boolean;
  /** How far the referred family must get before the reward is earned. */
  trigger: ReferralTrigger;
  mode: "fixed" | "percent";
  /** Paise when fixed; percent value when percent. */
  value: number;
  /** Fee head the discount lands on ("" = the tuition head). */
  feeHeadId: string;
  /** Rewards one referrer may earn in a session; 0 = no cap. */
  maxPerSession: number;
  note: string;
};

export const DEFAULT_REFERRAL_POLICY: ReferralRewardPolicy = {
  enabled: false,
  // The school's rule: a referral only becomes a discount once the referred
  // child is actually on the roll AND has paid a full month's fee. An
  // admission that never pays must not cost the school a discount.
  trigger: "paid_first_month",
  mode: "fixed",
  value: 50000,
  feeHeadId: "",
  maxPerSession: 0,
  note: "",
};

const REWARD_GRANT_PREFIX = "cg_ref_";
const REWARD_RULE_PREFIX = "cnc_ref_";

export function loadReferralPolicy(): ReferralRewardPolicy {
  const raw = (loadReferrals() as { rewardPolicy?: Partial<ReferralRewardPolicy> })
    .rewardPolicy;
  if (!raw) return { ...DEFAULT_REFERRAL_POLICY };
  return {
    enabled: !!raw.enabled,
    trigger:
      raw.trigger === "enquiry" ||
      raw.trigger === "registered" ||
      raw.trigger === "enrolled"
        ? raw.trigger
        : "paid_first_month",
    mode: raw.mode === "percent" ? "percent" : "fixed",
    value: Math.max(0, Math.round(Number(raw.value) || 0)),
    feeHeadId: String(raw.feeHeadId ?? ""),
    maxPerSession: Math.max(0, Math.round(Number(raw.maxPerSession) || 0)),
    note: String(raw.note ?? "").slice(0, 300),
  };
}

export function saveReferralPolicy(policy: ReferralRewardPolicy): void {
  const state = loadReferrals();
  saveReferrals({
    ...state,
    rewardPolicy: policy,
  } as typeof state & { rewardPolicy: ReferralRewardPolicy });
}

export function policyLabel(
  policy: ReferralRewardPolicy,
  masters?: MastersState,
): string {
  if (!policy.enabled) return "Referral rewards are off";
  const m = masters ?? loadMasters();
  const head =
    m.feeHeads.find((h) => h.id === policy.feeHeadId)?.nameEn ??
    m.feeHeads.find((h) => h.code === "TUITION")?.nameEn ??
    "Tuition Fee";
  const amount =
    policy.mode === "percent"
      ? `${policy.value}% off`
      : `${formatInr(policy.value)} off`;
  const when =
    policy.trigger === "enquiry"
      ? "when the referred family enquires"
      : policy.trigger === "registered"
        ? "when the referred family pays registration"
        : policy.trigger === "enrolled"
          ? "when the referred child takes admission"
          : "once the referred child is admitted AND has paid one full month's fee";
  const cap =
    policy.maxPerSession > 0
      ? ` · at most ${policy.maxPerSession} per referrer per session`
      : "";
  return `${amount} on ${head}, ${when}${cap}`;
}

/** Has this lead already been rewarded? Keyed by a marker in the grant. */
function rewardMarker(leadId: string): string {
  return `[ref:${leadId}]`;
}

export function rewardedLeadIds(masters?: MastersState): Set<string> {
  const m = masters ?? loadMasters();
  const out = new Set<string>();
  for (const g of m.concessionGrants ?? []) {
    if (g.status === "rejected") continue;
    const hit = g.reason.match(/\[ref:([^\]]+)\]/);
    if (hit?.[1]) out.add(hit[1]);
  }
  return out;
}

/**
 * Has the referred child paid one FULL month of school fees?
 *
 * "Full month" means an academic installment with nothing left on it — every
 * academic head of that month settled. Registration fees and part payments
 * do not count: the school's rule is that a referral earns its discount only
 * after the referred family has actually started paying.
 */
export function hasPaidOneFullMonth(studentId: string, sis?: SisState): boolean {
  if (!studentId) return false;
  const state = sis ?? loadSis();
  const student = state.students.find((s) => s.id === studentId);
  if (!student) return false;

  const dues = computeStudentDues(student, loadMasters(), loadFees(), {
    includeFuture: false,
    includePaid: true,
  }).filter((d) => d.kind === "academic" && d.installmentId);

  const byInstallment = new Map<string, FeeDueLine[]>();
  for (const d of dues) {
    const k = d.installmentId ?? "";
    (byInstallment.get(k) ?? byInstallment.set(k, []).get(k)!).push(d);
  }
  for (const lines of byInstallment.values()) {
    const paid = lines.reduce((s, l) => s + l.paidPaise, 0);
    const open = lines.reduce((s, l) => s + l.balancePaise, 0);
    if (paid > 0 && open <= 0) return true;
  }
  return false;
}

function stageReached(
  lead: AdmissionLead,
  trigger: ReferralTrigger,
  sis?: SisState,
): boolean {
  if (trigger === "enquiry") return true;
  if (trigger === "registered") {
    return (
      lead.registrationPaymentStatus === "paid" ||
      lead.stage === "applied" ||
      lead.stage === "verified" ||
      lead.stage === "enrolled"
    );
  }
  if (trigger === "paid_first_month") {
    if (lead.stage !== "enrolled" || !lead.studentId) return false;
    return hasPaidOneFullMonth(lead.studentId, sis);
  }
  return lead.stage === "enrolled";
}

/** The referrer's own child who should carry the discount. */
function wardOf(
  sis: SisState,
  householdId: string,
  academicYearCode: string,
): SisStudent | null {
  const mine = sis.students.filter(
    (s) =>
      s.householdId === householdId &&
      s.status === "active" &&
      (s.academicYearCode || DEFAULT_AY) === academicYearCode,
  );
  if (mine.length === 0) return null;
  // The one with a fee group is the one being billed; else the first.
  return mine.find((s) => !!s.feeGroupId) ?? mine[0]!;
}

function ensureRewardRule(
  masters: MastersState,
  policy: ReferralRewardPolicy,
  academicYearCode: string,
): { state: MastersState; rule: ConcessionRule } {
  const tuition =
    masters.feeHeads.find((h) => h.id === policy.feeHeadId) ??
    masters.feeHeads.find((h) => h.code === "TUITION") ??
    masters.feeHeads[0];
  const headId = tuition?.id ?? "";
  const id = `${REWARD_RULE_PREFIX}${policy.mode}_${policy.value}_${headId.slice(-6)}`;
  const existing = masters.concessions.find((c) => c.id === id);
  if (existing) return { state: masters, rule: existing };

  const rule = normalizeConcessionRule({
    id,
    code: `REF-${policy.mode === "percent" ? `${policy.value}PC` : policy.value}`.slice(0, 24),
    name:
      policy.mode === "percent"
        ? `Referral reward — ${policy.value}% off ${tuition?.nameEn ?? "fee"}`
        : `Referral reward — ${formatInr(policy.value)} off ${tuition?.nameEn ?? "fee"}`,
    kind: "referral",
    academicYearCode,
    mode: policy.mode,
    value: policy.value,
    siblingTiers: [],
    feeHeadIds: headId ? [headId] : [],
    autoApproveMaxPaise: null,
    documentationRequired: false,
    incompatibleCodes: [],
    notes: "Created by the referral reward policy",
    isActive: true,
  });
  return {
    state: { ...masters, concessions: [...masters.concessions, rule] },
    rule,
  };
}

export type ReferralAwardResult =
  | {
      ok: true;
      studentName: string;
      ruleName: string;
      grantId: string;
    }
  | { ok: false; error: string };

/**
 * Give one referrer their reward for one referred lead.
 *
 * Idempotent per lead: a lead already rewarded returns an error rather than
 * stacking a second grant, so pressing Award twice cannot double the
 * discount.
 */
export async function awardReferralForLead(input: {
  lead: AdmissionLead;
  by: string;
  academicYearCode?: string;
}): Promise<ReferralAwardResult> {
  const policy = loadReferralPolicy();
  if (!policy.enabled) {
    return { ok: false, error: "Referral rewards are switched off in the policy" };
  }
  if (policy.value <= 0) {
    return { ok: false, error: "The policy has no reward amount set" };
  }
  const sisEarly = loadSis();
  if (!stageReached(input.lead, policy.trigger, sisEarly)) {
    return {
      ok: false,
      error:
        policy.trigger === "paid_first_month"
          ? "Not yet — the referred child must be enrolled AND have paid one full month's fee"
          : `This referral has not reached the stage the policy rewards (${policy.trigger})`,
    };
  }

  const sis = sisEarly;
  const ay = input.academicYearCode || DEFAULT_AY;

  let householdId = input.lead.referredByHouseholdId;
  if (!householdId && input.lead.referralCode) {
    const code = input.lead.referralCode.trim().toUpperCase();
    householdId =
      sis.households.find((h) => referralCodeFor(h) === code)?.id ?? "";
  }
  if (!householdId) {
    return { ok: false, error: "No referring parent on this enquiry" };
  }

  if (rewardedLeadIds().has(input.lead.id)) {
    return { ok: false, error: "This referral has already been rewarded" };
  }

  const ward = wardOf(sis, householdId, ay);
  if (!ward) {
    return {
      ok: false,
      error: "The referring parent has no active child in this session",
    };
  }

  let masters = loadMasters();
  if (policy.maxPerSession > 0) {
    const mine = (masters.concessionGrants ?? []).filter(
      (g) =>
        g.id.startsWith(REWARD_GRANT_PREFIX) &&
        g.status !== "rejected" &&
        sis.students.some(
          (s) => s.id === g.studentId && s.householdId === householdId,
        ),
    );
    if (mine.length >= policy.maxPerSession) {
      return {
        ok: false,
        error: `This parent has already had ${mine.length} referral reward(s) — the policy caps it at ${policy.maxPerSession}`,
      };
    }
  }

  const ensured = ensureRewardRule(masters, policy, ay);
  masters = ensured.state;

  const grant: ConcessionGrant = normalizeConcessionGrant({
    id: `${REWARD_GRANT_PREFIX}${newId("x")}`,
    concessionId: ensured.rule.id,
    studentId: ward.id,
    status: "approved",
    reason: `Referral reward · referred ${input.lead.childName || "a family"} · by ${input.by} ${rewardMarker(input.lead.id)}`,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: null,
    createdAt: new Date().toISOString(),
    siblingChildNo: null,
  });

  const saved = await saveMasters({
    ...masters,
    concessionGrants: [...(masters.concessionGrants ?? []), grant],
  });
  if (!saved.ok) {
    return { ok: false, error: `Could not save the reward (${saved.reason})` };
  }

  return {
    ok: true,
    studentName: ward.fullName,
    ruleName: ensured.rule.name,
    grantId: grant.id,
  };
}

/** Leads that qualify right now and have not been rewarded yet. */
export function pendingReferralAwards(
  leads: AdmissionLead[],
  sis?: SisState,
): AdmissionLead[] {
  const policy = loadReferralPolicy();
  if (!policy.enabled) return [];
  const state = sis ?? loadSis();
  const done = rewardedLeadIds();
  return leads.filter((l) => {
    if (done.has(l.id)) return false;
    if (!stageReached(l, policy.trigger, state)) return false;
    if (l.referredByHouseholdId) return true;
    const code = (l.referralCode || "").trim().toUpperCase();
    if (!code) return false;
    return state.households.some((h) => referralCodeFor(h) === code);
  });
}
