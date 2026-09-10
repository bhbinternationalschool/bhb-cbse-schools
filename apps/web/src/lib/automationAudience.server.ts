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
import { householdWhatsApp, loadSis, type Household } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { listLiveDefaulters } from "@/lib/playbook";
import { currentAcademicYearCode, formatInr } from "@/lib/masters";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { publicOrigin } from "@/lib/birthday.server";
import { TENANT } from "@/lib/types";

export type AutomationRecipient = {
  /** Bare 10-digit / E.164-ish digits; the dispatch route normalizes. */
  mobile: string;
  /** Tried when the primary number fails synchronously (household altMobile). */
  fallbackMobile?: string;
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

/** STOP is honoured on every outbound path; automation is not an exception. */
async function dropOptedOut(
  recipients: AutomationRecipient[],
): Promise<{ kept: AutomationRecipient[]; skippedOptOut: number }> {
  if (!recipients.length) return { kept: [], skippedOptOut: 0 };
  const optedOut = await listOptedOutSet(
    recipients.map((r) => r.mobile),
  ).catch(() => new Set<string>());
  const kept: AutomationRecipient[] = [];
  let skippedOptOut = 0;
  for (const r of recipients) {
    if (optedOut.has(toE164India(r.mobile))) skippedOptOut++;
    else kept.push(r);
  }
  return { kept, skippedOptOut };
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

async function feeRecipients(
  kind: "overdue" | "due_soon",
  todayIso: string,
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
  for (const d of rows) {
    if (kind === "overdue") {
      if (d.overdueDays <= 0 || d.overdueAmountPaise <= 0) continue;
    } else {
      // Due soon = not yet overdue, but inside the next three days.
      if (d.overdueDays > 0) continue;
      if (!d.earliestDueOn || d.earliestDueOn > horizon) continue;
      if (d.openAmountPaise <= 0) continue;
    }
    const hh = householdOf(sis.households ?? [], d.householdId);
    const mobile = householdWhatsApp(hh) || hh?.mobile || "";
    if (!mobile) continue;
    const amountPaise =
      kind === "overdue" ? d.overdueAmountPaise : d.openAmountPaise;
    out.push({
      mobile,
      fallbackMobile: hh?.altMobile || undefined,
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
  const out: AutomationRecipient[] = [];
  for (const hh of sis.households ?? []) {
    if (!activeHouseholdIds.has(hh.id)) continue;
    const mobile = householdWhatsApp(hh) || hh.mobile || "";
    if (!mobile) continue;
    out.push({
      mobile,
      fallbackMobile: hh.altMobile || undefined,
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
  const limit = Math.max(1, opts?.limit ?? 500);
  const key = automationAudienceKey(rule);

  try {
    let recipients: AutomationRecipient[];
    switch (key) {
      case "fee_overdue":
        recipients = await feeRecipients("overdue", todayIso);
        break;
      case "fee_due_soon":
        recipients = await feeRecipients("due_soon", todayIso);
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
      default:
        return {
          ok: false,
          error:
            `No server-side audience for "${rule.audienceSummary || rule.module}". ` +
            `Event-driven rules are sent by the module that raises the event; ` +
            `for a scheduled rule pick an audience the tick can resolve ` +
            `(fees, admissions or all parents) in Masters → Automation.`,
        };
    }

    const unique = dedupeByMobile(recipients);
    const { kept, skippedOptOut } = await dropOptedOut(unique);
    const capped = kept.slice(0, limit);
    const note =
      `${capped.length} recipient${capped.length === 1 ? "" : "s"} from live data` +
      (skippedOptOut ? ` · ${skippedOptOut} opted out (STOP)` : "") +
      (kept.length > capped.length
        ? ` · capped at ${limit} for this run, the rest go on the next tick`
        : "");
    return { ok: true, recipients: capped, skippedOptOut, note };
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
