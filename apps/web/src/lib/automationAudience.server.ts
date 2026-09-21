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
import { loadSis, studentsInSession, type Household } from "@/lib/sis";
import { familyReminderValues, type FamilyChildDue } from "@/lib/feeFamilyReminder";
import { reviewDemoHouseholdIds } from "@/lib/reviewDemoRecords";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { ensureFeeDuesInputsHydrated } from "@/lib/feeDuesInputs.server";
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
import { duePayTokenFor, duePayUrl } from "@/lib/duePayToken.server";
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

/**
 * One message per phone number.
 *
 * Fee reminders are already one per FAMILY before this runs (see
 * liveFeeFamilies), so for them this only matters when two different
 * households share a number — none of the families owing on 21 Sep 2026
 * did. It used to be what turned a per-child list into "one per family",
 * by keeping the first child and silently dropping the siblings' dues.
 */
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
  const families = await liveFeeFamilies(kind, todayIso);

  // Every number every family has, asked about in one go — the choice
  // below needs to know which of them Meta has already refused.
  const sis = loadSis();
  const knownBad = await listKnownNotOnWhatsApp(
    families.flatMap((f) => f.candidates.map((c) => c.mobile10)),
  ).catch(() => new Set<string>());

  const out: AutomationRecipient[] = [];
  for (const f of families) {
    // The floor is the FAMILY's. It used to be each child's, so two
    // children owing ₹1,500 each — ₹3,000 between them — were never
    // reminded while one child owing ₹2,000 was.
    if (f.totalPaise <= 0) continue;
    if (minAmountPaise > 0 && f.totalPaise < minAmountPaise) continue;
    // The designated number first, then the guardian's, the father's, the
    // mother's, the alternate — skipping any Meta has said has no WhatsApp
    // account. A family whose first number is dead is still reached.
    const choice = pickWaNumbers(f.candidates, knownBad);
    if (!choice.primary) continue;
    const hh = householdOf(sis.households ?? [], f.householdId);
    out.push({
      mobile: choice.primary.mobile10,
      fallbackMobile: choice.fallback?.mobile10,
      numberLabel: choice.primary.label,
      language: waTemplateLanguageFor(hh ?? {}),
      refId: f.householdId,
      label: `${f.values.childName} · ${f.values.classLabel}`,
      variables: feeFamilyVariables(f, hh, kind, minAmountPaise),
    });
  }
  return out;
}

/**
 * The template values for one family, and the keys the send step needs to
 * recompute them.
 *
 * `householdId` and `feeScope` are not template words — the dispatcher
 * reads them to fetch this family's dues again at the moment of sending
 * (see liveFeeCard), because a card is a snapshot and a parent may have
 * paid between the card and the tap.
 */
function feeFamilyVariables(
  f: LiveFeeFamily,
  hh: Household | null | undefined,
  kind: "overdue" | "due_soon",
  minAmountPaise: number,
): Record<string, string> {
  const scope = kind === "overdue" ? "overdue" : "open";
  return {
    schoolName: TENANT.nameDisplay,
    guardianName: hh?.guardianName || "Parent",
    childName: f.values.childName,
    classLabel: f.values.classLabel,
    feeDue: f.values.feeDue,
    amount: formatInr(f.totalPaise),
    dueDate: f.earliestDueOn,
    overdueDays: String(Math.max(0, f.overdueDays)),
    stage: f.stageLabel,
    // The whole family's payment link — every child's dues in one checkout,
    // matching the message. It was each child's own link until 21 Sep 2026,
    // so a family told about one child could only pay for that one.
    payLink: duePayUrl(publicOrigin(), { householdId: f.householdId, scope }) || PARENT_PORTAL,
    duePayToken: duePayTokenFor({ householdId: f.householdId, scope }),
    householdId: f.householdId,
    feeScope: kind,
    minPaise: String(Math.max(0, Math.round(minAmountPaise))),
  };
}

export type LiveFeeFamily = {
  householdId: string;
  children: FamilyChildDue[];
  totalPaise: number;
  values: ReturnType<typeof familyReminderValues>;
  earliestDueOn: string;
  overdueDays: number;
  stageLabel: string;
  candidates: WaCandidateNumber[];
};

/**
 * Every family owing money right now, one entry per household, every child
 * in it, every kind of due — computed from the live fee engine and the
 * store's own balances at the moment of the call.
 *
 * Exported for the send step, which calls it again when a card is approved
 * so the amount a parent reads is today's, not the card's.
 */
export async function liveFeeFamilies(
  kind: "overdue" | "due_soon",
  todayIso: string,
  onlyHouseholds?: Set<string>,
): Promise<LiveFeeFamily[]> {
  // Transport and the posted adjustments too, or a reminder quotes school
  // fee only — the bus fee of 157 riders was missing from every one of
  // these messages until 2026-09-16 (lib/feeDuesInputs.server.ts).
  await Promise.all([
    ensureSisHydratedServer(),
    ensureFeesHydratedServer(),
    ensureFeeDuesInputsHydrated(),
  ]);
  const sis = loadSis();
  const masters = await loadServerMasters();
  const academicYearCode = currentAcademicYearCode(masters);
  const hindiFor = (householdId: string) =>
    waTemplateLanguageFor(householdOf(sis.households ?? [], householdId) ?? {}) === "hi";

  const rows = listLiveDefaulters({
    asOf: todayIso,
    academicYearCode,
    includeUpcoming: kind === "due_soon",
    sis,
    masters,
  }).filter((d) => !onlyHouseholds || onlyHouseholds.has(d.householdId));

  const horizon = shiftIso(todayIso, 3);
  type Acc = {
    children: Map<string, FamilyChildDue>;
    earliestDueOn: string;
    overdueDays: number;
    stageLabel: string;
  };
  const byHousehold = new Map<string, Acc>();
  const accFor = (householdId: string) => {
    let a = byHousehold.get(householdId);
    if (!a) {
      a = { children: new Map(), earliestDueOn: "", overdueDays: 0, stageLabel: "" };
      byHousehold.set(householdId, a);
    }
    return a;
  };

  for (const d of rows) {
    if (!d.householdId) continue;
    let lines;
    if (kind === "overdue") {
      if (d.overdueDays <= 0 || d.overdueAmountPaise <= 0) continue;
      lines = d.overdueDues;
    } else {
      // Due soon = not yet overdue, but inside the next three days.
      if (d.overdueDays > 0) continue;
      if (!d.earliestDueOn || d.earliestDueOn > horizon) continue;
      if (d.openAmountPaise <= 0) continue;
      lines = d.openDues;
    }
    const sum = (k: string) =>
      lines.filter((l) => l.kind === k).reduce((s, l) => s + Math.max(0, l.balancePaise), 0);
    const all = lines.reduce((s, l) => s + Math.max(0, l.balancePaise), 0);
    const transport = sum("transport");
    const store = sum("store");
    const a = accFor(d.householdId);
    a.children.set(d.studentId, {
      name: d.fullName,
      classLabel: d.classLabel,
      feesPaise: all - transport - store,
      transportPaise: transport,
      storePaise: store,
    });
    // The family is as late as its latest child.
    if (d.overdueDays >= a.overdueDays) {
      a.overdueDays = d.overdueDays;
      a.stageLabel = d.stageLabel;
    }
    if (d.earliestDueOn && (!a.earliestDueOn || d.earliestDueOn < a.earliestDueOn)) {
      a.earliestDueOn = d.earliestDueOn;
    }
  }

  // Store credit — books, uniform — owed now, so it belongs in the overdue
  // reminder and not in a "due in three days" one. Read from the store's own
  // balances, the same source the fee counter uses; the fee engine is never
  // asked to guess them. A family that owes the store alone is a family that
  // owes the school, and is reminded too.
  if (kind === "overdue") {
    const inSession = studentsInSession(sis, academicYearCode).filter(
      (s) => s.status === "active" && s.householdId && (!onlyHouseholds || onlyHouseholds.has(s.householdId)),
    );
    const { storeDuesForStudents } = await import("@/lib/inventory/sales.server");
    // A store that cannot be read is not a store that is owed nothing — but
    // it must not stop the fee reminder either. The fee part still goes, and
    // the reason is logged; the store part waits for a run that can read it.
    const storeDues = await storeDuesForStudents(inSession.map((s) => s.id)).catch((e) => {
      console.warn("[automationAudience] store dues unreadable — fee dues only this run", (e as Error)?.message);
      return [];
    });
    const studentById = new Map(inSession.map((s) => [s.id, s]));
    for (const sd of storeDues) {
      if (sd.balancePaise <= 0) continue;
      const st = studentById.get(sd.studentId);
      if (!st?.householdId) continue;
      const a = accFor(st.householdId);
      const existing = a.children.get(st.id);
      if (existing) existing.storePaise += sd.balancePaise;
      else {
        a.children.set(st.id, {
          name: st.fullName,
          classLabel: classLabelOf(st, masters),
          feesPaise: 0,
          transportPaise: 0,
          storePaise: sd.balancePaise,
        });
      }
      const saleDay = (sd.saleDate || "").slice(0, 10);
      if (saleDay && (!a.earliestDueOn || saleDay < a.earliestDueOn)) a.earliestDueOn = saleDay;
    }
  }

  const out: LiveFeeFamily[] = [];
  for (const [householdId, a] of byHousehold) {
    const children = [...a.children.values()];
    const values = familyReminderValues({ children, hindi: hindiFor(householdId) });
    if (values.totalPaise <= 0) continue;
    out.push({
      householdId,
      children,
      totalPaise: values.totalPaise,
      values,
      earliestDueOn: a.earliestDueOn,
      overdueDays: a.overdueDays,
      stageLabel: a.stageLabel || "S1",
      candidates: householdCandidateNumbers({
        household: householdOf(sis.households ?? [], householdId),
        // This session's children only — an old year's row holds exactly
        // the kind of parent number that has since changed.
        students: studentsInSession(sis, academicYearCode).filter(
          (s) => s.householdId === householdId && s.status === "active",
        ),
      }),
    });
  }
  // Longest overdue first, then largest — the order the old per-child list
  // used, now for families.
  return out.sort((x, y) => y.overdueDays - x.overdueDays || y.totalPaise - x.totalPaise);
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

    // The Play review family is not a family: its number has failed every
    // send and Meta has marked it as not on WhatsApp. It never belongs in
    // an outbound audience.
    const demoHouseholds = reviewDemoHouseholdIds(loadSis());
    const realOnly = recipients.filter((r) => !demoHouseholds.has(r.refId));
    const unique = dedupeByMobile(realOnly);
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
