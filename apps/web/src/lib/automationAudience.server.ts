/**
 * Who a scheduled automation rule actually writes to, resolved server-side.
 *
 * Until this existed, `evaluateAutomationTick` built every approval from
 * `demoPreviewForRule()` — two hardcoded numbers, 9876543210 and
 * 9123456780. That was survivable while the tick only ever proposed cards
 * for a human to look at. It stops being survivable the moment a rule is
 * switched to auto-run, because then the school really sends, and it
 * really sends to two numbers that belong to strangers.
 *
 * So the audience comes from the database or the rule proposes nothing.
 * There is deliberately no fallback: a rule whose audience cannot be
 * resolved records WHY on its approval card and dispatches zero messages.
 * "Sent to nobody, and here is the reason" is a state the office can fix;
 * "sent to a demo number" is not.
 */

import "server-only";

import type { AutomationRule } from "@/lib/automation";
import { findAudiencePresetBySummary } from "@/lib/automationAudience";
import { loadSis, type Household } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { listLiveDefaulters } from "@/lib/playbook";
import { currentAcademicYearCode, formatInr } from "@/lib/masters";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { listKnownNotOnWhatsApp } from "@/lib/waNumberHealth.server";
import {
  householdCandidateNumbers,
  pickWaNumbers,
  type WaCandidateNumber,
} from "@/lib/waHouseholdNumbers";
import { publicOrigin } from "@/lib/birthday.server";
import { TENANT } from "@/lib/types";

export type AutomationRecipient = {
  /** Bare 10-digit / E.164-ish digits; the dispatch route normalizes. */
  mobile: string;
  /** The next usable number for this family, on a synchronous failure. */
  fallbackMobile?: string;
  /**
   * Which of the family's numbers this is — "Father's number" when the
   * designated one turned out not to be on WhatsApp, so the approval card
   * and the delivery log say who was actually written to.
   */
  numberLabel?: string;
  /** The FAMILY's template language, never the sender's. */
  language: "en" | "hi";
  variables: Record<string, string>;
  /** Household / lead id — dedupe and logging, never sent. */
  refId: string;
  /** One line for the approval card: "Aarav Sharma · V-A". */
  label: string;
};

export type AutomationAudience =
  | {
      ok: true;
      recipients: AutomationRecipient[];
      /** How many were dropped for STOP, so approvals can say so. */
      skippedOptOut: number;
      /** Dropped because Meta says the number has no WhatsApp account. */
      skippedNotOnWhatsApp: number;
      note: string;
    }
  | { ok: false; error: string };

/** Audience presets this resolver can answer from the database today. */
const RESOLVABLE = new Set([
  "fee_overdue",
  "fee_due_soon",
  "admission_followup",
  "admission_reg_fee",
  "all_parents",
  "udise_docs_missing",
]);

/**
 * The audience key for a rule.
 *
 * The picker writes a preset's `summary` into `audienceSummary`, so that is
 * the first and best answer. A rule edited by hand (or seeded before the
 * picker existed) falls back to its template family, which for the seeded
 * rules names the same audience.
 */
export function automationAudienceKey(rule: AutomationRule): string {
  const preset = findAudiencePresetBySummary(rule.audienceSummary);
  if (preset && RESOLVABLE.has(preset.id)) return preset.id;
  switch (rule.templateFamilyKey) {
    case "fees_stage_reminder":
      return "fee_overdue";
    case "fees_soft_reminder":
      return "fee_due_soon";
    case "admissions_followup":
      return "admission_followup";
    case "admissions_fee_reminder":
      return "admission_reg_fee";
    case "udise_docs_request":
      return "udise_docs_missing";
    default:
      return preset?.id || "";
  }
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function householdOf(
  households: Household[],
  householdId: string,
): Household | undefined {
  return households.find((h) => h.id === householdId);
}

/**
 * Who must not be written to.
 *
 * Two independent reasons, both honoured on every outbound path:
 *   * STOP — the family asked us to stop.
 *   * Not on WhatsApp — Meta has already said the number has no WhatsApp
 *     account, so a send would only produce another failure row. Ten of
 *     this school's numbers are in that state.
 */
async function dropUnreachable(
  recipients: AutomationRecipient[],
): Promise<{
  kept: AutomationRecipient[];
  skippedOptOut: number;
  skippedNotOnWhatsApp: number;
}> {
  if (!recipients.length) {
    return { kept: [], skippedOptOut: 0, skippedNotOnWhatsApp: 0 };
  }
  const mobiles = recipients.map((r) => r.mobile);
  const [optedOut, notOnWa] = await Promise.all([
    listOptedOutSet(mobiles).catch(() => new Set<string>()),
    listKnownNotOnWhatsApp(mobiles).catch(() => new Set<string>()),
  ]);
  const kept: AutomationRecipient[] = [];
  let skippedOptOut = 0;
  let skippedNotOnWhatsApp = 0;
  for (const r of recipients) {
    const key = toE164India(r.mobile);
    if (optedOut.has(key)) skippedOptOut++;
    else if (notOnWa.has(key)) skippedNotOnWhatsApp++;
    else kept.push(r);
  }
  return { kept, skippedOptOut, skippedNotOnWhatsApp };
}

/** One recipient per household — siblings must not get the same message twice. */
function dedupeByMobile(recipients: AutomationRecipient[]): AutomationRecipient[] {
  const seen = new Set<string>();
  const out: AutomationRecipient[] = [];
  for (const r of recipients) {
    const key = toE164India(r.mobile);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

const PARENT_PORTAL = `${publicOrigin()}/parent`;

/**
 * How many families one rule may be sent to in a single tick.
 *
 * Cloud Run cuts the tick's request at 300s, and each message is a Graph
 * API round trip plus a household lookup — at roughly half a second each,
 * 500 recipients does not fit and the tick is killed part-way through.
 * 150 leaves room for two cards and the audience reads inside one request.
 * Raise WA_AUTOMATION_TICK_LIMIT only alongside the Cloud Run timeout.
 */
function perTickRecipientCap(): number {
  const raw = Number(process.env.WA_AUTOMATION_TICK_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 150;
}

async function feeRecipients(
  kind: "overdue" | "due_soon",
  todayIso: string,
  minAmountPaise: number,
): Promise<AutomationRecipient[]> {
  await Promise.all([ensureSisHydratedServer(), ensureFeesHydratedServer()]);
  const sis = loadSis();
  const masters = await loadServerMasters();
  const academicYearCode = currentAcademicYearCode(masters);
  const rows = listLiveDefaulters({
    asOf: todayIso,
    academicYearCode,
    includeUpcoming: kind === "due_soon",
    sis,
    masters,
  });

  const horizon = shiftIso(todayIso, 3);
  const out: AutomationRecipient[] = [];

  // Every number every candidate family has, asked about in one go — the
  // choice below needs to know which of them Meta has already refused.
  const allCandidates = new Map<string, WaCandidateNumber[]>();
  for (const d of rows) {
    if (allCandidates.has(d.householdId)) continue;
    const hh = householdOf(sis.households ?? [], d.householdId);
    allCandidates.set(
      d.householdId,
      householdCandidateNumbers({
        household: hh,
        students: (sis.students ?? []).filter(
          (s) => s.householdId === d.householdId && s.status === "active",
        ),
      }),
    );
  }
  const knownBad = await listKnownNotOnWhatsApp(
    [...allCandidates.values()].flat().map((c) => c.mobile10),
  ).catch(() => new Set<string>());

  for (const d of rows) {
    if (kind === "overdue") {
      if (d.overdueDays <= 0 || d.overdueAmountPaise <= 0) continue;
    } else {
      // Due soon = not yet overdue, but inside the next three days.
      if (d.overdueDays > 0) continue;
      if (!d.earliestDueOn || d.earliestDueOn > horizon) continue;
      if (d.openAmountPaise <= 0) continue;
    }
    const amountPaise =
      kind === "overdue" ? d.overdueAmountPaise : d.openAmountPaise;
    // The rule's own floor. A family under it is not a defaulter worth
    // chasing on WhatsApp — ₹200 outstanding is a conversation at the
    // counter, not a reminder that lands on a parent's phone.
    if (minAmountPaise > 0 && amountPaise < minAmountPaise) continue;
    const hh = householdOf(sis.households ?? [], d.householdId);
    // The designated number first, then the guardian's, the father's, the
    // mother's, the alternate — skipping any Meta has said has no WhatsApp
    // account. A family whose first number is dead is still reached.
    const choice = pickWaNumbers(
      allCandidates.get(d.householdId) ?? [],
      knownBad,
    );
    if (!choice.primary) continue;
    const mobile = choice.primary.mobile10;
    out.push({
      mobile,
      fallbackMobile: choice.fallback?.mobile10,
      numberLabel: choice.primary.label,
      language: waTemplateLanguageFor(hh ?? {}),
      refId: d.householdId || d.studentId,
      label: `${d.fullName} · ${d.classLabel}`,
      variables: {
        schoolName: TENANT.nameDisplay,
        guardianName: hh?.guardianName || "Parent",
        childName: d.fullName,
        classLabel: d.classLabel,
        feeDue: formatInr(amountPaise),
        amount: formatInr(amountPaise),
        dueDate: d.earliestDueOn,
        overdueDays: String(Math.max(0, d.overdueDays)),
        stage: d.stageLabel,
        payLink: PARENT_PORTAL,
      },
    });
  }
  return out;
}

async function admissionRecipients(
  kind: "followup" | "reg_fee",
  todayIso: string,
): Promise<AutomationRecipient[]> {
  const { ensureAdmissionsHydratedServer } = await import(
    "@/lib/admissionsPersistence"
  );
  const { loadAdmissions, registrationBalancePaise } = await import(
    "@/lib/admissions"
  );
  await ensureAdmissionsHydratedServer();
  const state = loadAdmissions();
  const open = (state.leads ?? []).filter(
    (l) => l.stage !== "enrolled" && l.stage !== "lost",
  );

  const out: AutomationRecipient[] = [];
  for (const lead of open) {
    if (kind === "followup") {
      const due = (lead.nextFollowUpAt || "").slice(0, 10);
      if (!due || due > todayIso) continue;
    } else {
      if (lead.registrationFeePaid) continue;
      if (registrationBalancePaise(state, lead) <= 0) continue;
    }
    const mobile =
      (lead.whatsappSame ? lead.mobile : lead.whatsapp || lead.mobile) || "";
    if (!mobile) continue;
    const balancePaise =
      kind === "reg_fee" ? registrationBalancePaise(state, lead) : 0;
    out.push({
      mobile,
      language: waTemplateLanguageFor({
        preferredLanguage: lead.preferredLanguage,
      }),
      refId: lead.id,
      label: `${lead.childName || "Enquiry"} · ${lead.enquiryNo || lead.id}`,
      variables: {
        schoolName: TENANT.nameDisplay,
        guardianName:
          lead.whatsappDisplayName || lead.guardianName || "Parent",
        childName: lead.childName || "your child",
        feeDue: balancePaise ? formatInr(balancePaise) : "",
        amount: balancePaise ? formatInr(balancePaise) : "",
        payLink: PARENT_PORTAL,
        registerLink: `${publicOrigin()}/admissions`,
      },
    });
  }
  return out;
}

/**
 * Families with something the UDISE+ register still lacks, one message per
 * household naming every document to send. A child whose PEN and APAAR are
 * both issued has no gaps and is not asked; a household whose only gap is
 * on the portal's side (verification pending) is not asked either — a parent
 * cannot fix that with a photo.
 */
async function udiseRecipients(todayIso: string): Promise<AutomationRecipient[]> {
  await ensureSisHydratedServer();
  const sis = loadSis();
  const masters = await loadServerMasters();
  const academicYearCode = currentAcademicYearCode(masters);
  const { computeStudentUdiseGaps } = await import("@/lib/udiseCompliance");
  const { missingDocsFor } = await import("@/lib/udiseDocIntakeAi");

  type Need = { student: (typeof sis.students)[number]; gaps: string[]; hasDob: boolean; hasAddress: boolean };
  const byHousehold = new Map<string, Need[]>();
  for (const s of sis.students ?? []) {
    if (s.status !== "active" || !s.householdId) continue;
    if (s.academicYearCode && s.academicYearCode !== academicYearCode) continue;
    const hh = householdOf(sis.households ?? [], s.householdId);
    const gaps = computeStudentUdiseGaps(s);
    const hasDob = !!s.dob;
    const hasAddress = !!(hh?.address && hh?.pincode) || !!s.permanentAddress;
    const askable = gaps.some((g) => g === "student_aadhaar" || g === "parent_aadhaar") || !hasDob || !hasAddress;
    if (!askable) continue;
    const list = byHousehold.get(s.householdId) ?? [];
    list.push({ student: s, gaps, hasDob, hasAddress });
    byHousehold.set(s.householdId, list);
  }

  const candidates = new Map<string, WaCandidateNumber[]>();
  for (const [hhId] of byHousehold) {
    const hh = householdOf(sis.households ?? [], hhId);
    candidates.set(hhId, householdCandidateNumbers({ household: hh, students: (sis.students ?? []).filter((s) => s.householdId === hhId && s.status === "active") }));
  }
  const knownBad = await listKnownNotOnWhatsApp([...candidates.values()].flat().map((c) => c.mobile10)).catch(() => new Set<string>());

  const dueDate = shiftIso(todayIso, 7);
  const out: AutomationRecipient[] = [];
  for (const [hhId, needs] of byHousehold) {
    const hh = householdOf(sis.households ?? [], hhId);
    const choice = pickWaNumbers(candidates.get(hhId) ?? [], knownBad);
    if (!choice.primary) continue;
    const language = waTemplateLanguageFor(hh ?? {});
    // One line per child when siblings need different things; one list when
    // the household has one child, which is most of them.
    const parts = needs.map((n) => {
      const docs = missingDocsFor({ gaps: n.gaps, hasDob: n.hasDob, hasAddress: n.hasAddress, language });
      return needs.length > 1 ? `${n.student.fullName.split(/\s+/)[0]}: ${docs}` : docs;
    });
    const first = needs[0]!.student;
    out.push({
      mobile: choice.primary.mobile10,
      fallbackMobile: choice.fallback?.mobile10,
      numberLabel: choice.primary.label,
      language,
      refId: hhId,
      label: `${first.fullName}${needs.length > 1 ? ` +${needs.length - 1}` : ""}`,
      variables: {
        schoolName: TENANT.nameDisplay,
        guardianName: hh?.guardianName || "Parent",
        childName: needs.length > 1 ? needs.map((n) => n.student.fullName.split(/\s+/)[0]).join(", ") : first.fullName,
        classLabel: needs.length > 1 ? "siblings" : classLabelOf(first, masters),
        missingDocs: parts.join(" · ").slice(0, 900),
        dueDate: formatDueDate(dueDate, language),
      },
    });
  }
  return out;
}

function classLabelOf(s: { classId: string; sectionId: string }, masters: Awaited<ReturnType<typeof loadServerMasters>>): string {
  const c = (masters.classes ?? []).find((x) => x.id === s.classId)?.name ?? "—";
  const sec = (masters.sections ?? []).find((x) => x.id === s.sectionId)?.name ?? "";
  return sec ? `${c}-${sec}` : c;
}

function formatDueDate(iso: string, language: "en" | "hi"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "long", timeZone: "UTC" });
}

async function allParentRecipients(): Promise<AutomationRecipient[]> {
  await ensureSisHydratedServer();
  const sis = loadSis();
  const masters = await loadServerMasters();
  const academicYearCode = currentAcademicYearCode(masters);
  const activeHouseholdIds = new Set(
    (sis.students ?? [])
      .filter(
        (s) =>
          s.status === "active" &&
          (!s.academicYearCode || s.academicYearCode === academicYearCode),
      )
      .map((s) => s.householdId)
      .filter(Boolean),
  );
  // Same treatment as the fee audiences: a whole-school notice should reach
  // the father's number when the designated one is dead, not vanish.
  const candidates = new Map<string, WaCandidateNumber[]>();
  for (const hh of sis.households ?? []) {
    if (!activeHouseholdIds.has(hh.id)) continue;
    candidates.set(
      hh.id,
      householdCandidateNumbers({
        household: hh,
        students: (sis.students ?? []).filter(
          (s) => s.householdId === hh.id && s.status === "active",
        ),
      }),
    );
  }
  const knownBad = await listKnownNotOnWhatsApp(
    [...candidates.values()].flat().map((c) => c.mobile10),
  ).catch(() => new Set<string>());

  const out: AutomationRecipient[] = [];
  for (const hh of sis.households ?? []) {
    if (!activeHouseholdIds.has(hh.id)) continue;
    const choice = pickWaNumbers(candidates.get(hh.id) ?? [], knownBad);
    if (!choice.primary) continue;
    out.push({
      mobile: choice.primary.mobile10,
      fallbackMobile: choice.fallback?.mobile10,
      numberLabel: choice.primary.label,
      language: waTemplateLanguageFor(hh),
      refId: hh.id,
      label: hh.guardianName || hh.code || hh.id,
      variables: {
        schoolName: TENANT.nameDisplay,
        guardianName: hh.guardianName || "Parent",
        childName: "your child",
        payLink: PARENT_PORTAL,
      },
    });
  }
  return out;
}

/**
 * The real audience for one rule, or an explicit reason there is none.
 *
 * Never throws: a database hiccup becomes `{ ok: false }` with the message
 * on the approval card, so the tick keeps evaluating the other rules.
 */
export async function resolveAutomationAudienceServer(
  rule: AutomationRule,
  opts?: { todayIso?: string; limit?: number },
): Promise<AutomationAudience> {
  const todayIso = opts?.todayIso || new Date().toISOString().slice(0, 10);
  const limit = Math.max(1, opts?.limit ?? perTickRecipientCap());
  const minAmountPaise = Math.max(0, Math.round(rule.minAmountPaise || 0));
  const key = automationAudienceKey(rule);

  try {
    let recipients: AutomationRecipient[];
    switch (key) {
      case "fee_overdue":
        recipients = await feeRecipients("overdue", todayIso, minAmountPaise);
        break;
      case "fee_due_soon":
        recipients = await feeRecipients("due_soon", todayIso, minAmountPaise);
        break;
      case "admission_followup":
        recipients = await admissionRecipients("followup", todayIso);
        break;
      case "admission_reg_fee":
        recipients = await admissionRecipients("reg_fee", todayIso);
        break;
      case "all_parents":
        recipients = await allParentRecipients();
        break;
      case "udise_docs_missing":
        recipients = await udiseRecipients(todayIso);
        break;
      default:
        return {
          ok: false,
          error:
            `No server-side audience for "${rule.audienceSummary || rule.module}". ` +
            `Event-driven rules are sent by the module that raises the event; ` +
            `for a scheduled rule pick an audience the tick can resolve ` +
            `(fees, admissions, UDISE+ documents or all parents) in Masters → Automation.`,
        };
    }

    const unique = dedupeByMobile(recipients);
    const { kept, skippedOptOut, skippedNotOnWhatsApp } =
      await dropUnreachable(unique);
    const capped = kept.slice(0, limit);
    const note =
      `${capped.length} recipient${capped.length === 1 ? "" : "s"} from live data` +
      (minAmountPaise > 0 ? ` · at least ${formatInr(minAmountPaise)} due` : "") +
      (skippedOptOut ? ` · ${skippedOptOut} opted out (STOP)` : "") +
      (skippedNotOnWhatsApp
        ? ` · ${skippedNotOnWhatsApp} not on WhatsApp (see Numbers to fix)`
        : "") +
      (kept.length > capped.length
        ? ` · capped at ${limit} for this run, the rest go on the next tick`
        : "");
    return {
      ok: true,
      recipients: capped,
      skippedOptOut,
      skippedNotOnWhatsApp,
      note,
    };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `Could not read the audience: ${e.message}`
          : "Could not read the audience",
    };
  }
}
