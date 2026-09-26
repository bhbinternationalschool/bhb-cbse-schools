/**
 * Server-side audience resolution for automation rules.
 *
 * Until 2026-09 the automation tick "previewed" every rule with two
 * hard-coded sample numbers and never looked at the fee desk at all, so a
 * rule scheduled to remind defaulters proposed — and, on approval, sent —
 * nothing to any real family. This module builds the REAL recipient list
 * for a rule, the same way the fee desk's own WhatsApp command does:
 *
 *   - defaulters come from `listLiveDefaulters` (the Fees → Defaulters
 *     ledger), one message per family with their own child, amount and
 *     stage;
 *   - the family's own template language (en / hi), and the family is
 *     refused rather than sent the wrong language when the template is
 *     only half-approved;
 *   - STOP (opt-out) is honoured; the once-a-week cap is shared with the
 *     WhatsApp "fee reminder" command so two paths cannot chase the same
 *     family on the same day.
 *
 * Only audiences the server can build are supported; anything else comes
 * back `supported: false` with a reason the office can act on, and the
 * tick records a failed run instead of inventing a list.
 */

import "server-only";

import type {
  AudiencePreview,
  AutomationRecipient,
  AutomationRule,
  AutomationSkipNote,
} from "@/lib/automation";
import { AUTOMATION_AUDIENCE_PRESETS } from "@/lib/automationAudience";
import { daysSince, templatesByLanguage } from "@/lib/erpCommands";
import { formatInr, type MastersState } from "@/lib/masters";
import { classLabel } from "@/lib/homework";
import { householdWhatsApp, loadSis, type Household } from "@/lib/sis";
import { listLiveDefaulters, type LiveDefaulter } from "@/lib/playbook";
import { isInQuietHours as inFamilyQuietHours, waTemplateLanguageFor } from "@/lib/householdPrefs";
import { istDateOf } from "@/lib/teaching";
import { TENANT } from "@/lib/types";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { approvedTemplatesServer } from "@/lib/waTemplatesRead.server";
import { loadAutomationSendLedger } from "@/lib/automationLedger.server";

/** Audience presets the server can build today. */
export const SERVER_SUPPORTED_AUDIENCES = new Set(["fee_overdue", "fee_due_soon"]);

const DUE_SOON_DAYS = 3;

export function fillTemplateBody(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key: string) =>
    vars[key] != null && vars[key] !== "" ? vars[key]! : "—",
  );
}

function presetLabel(key: string): string {
  return AUTOMATION_AUDIENCE_PRESETS.find((p) => p.id === key)?.label || key;
}

type FeeContext = {
  todayIso: string;
  academicYearCode: string;
  sis: ReturnType<typeof loadSis>;
  masters: MastersState;
};

async function loadFeeContext(): Promise<FeeContext> {
  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  const { ensureFeesHydratedServer } = await import("@/lib/feesPersistence.server");
  const { ensureSisHydratedServer } = await import("@/lib/sisPersistence");
  const { loadServerMasters } = await import("@/lib/api/v1/auth");
  const { currentAcademicYearCode } = await import("@/lib/masters");
  // The mirror carries sis + fees + masters; the two desk hydrators layer
  // the normalized tables on top (a cold Cloud Run instance has none of it).
  await ensureSchoolMirrorHydrated();
  await Promise.all([ensureFeesHydratedServer(), ensureSisHydratedServer()]);
  const masters = await loadServerMasters();
  return {
    todayIso: istDateOf(),
    academicYearCode: currentAcademicYearCode(masters),
    sis: loadSis(),
    masters,
  };
}

function stageWord(d: LiveDefaulter): string {
  // "(reminder S3 Serious)" reads oddly to a parent; give the template a
  // short, human stage: the number of the reminder wave.
  const n = d.stage === "S1" ? "1" : d.stage === "S2" ? "2" : d.stage === "S3" ? "3" : d.stage === "S4" ? "4" : "0";
  return n;
}

export type ResolveAudienceOptions = {
  /** Skip the once-per-N-days ledger (used by "Preview" so the office sees everyone). */
  ignoreCap?: boolean;
  now?: Date;
};

/**
 * Build the recipient list for one rule. Never throws: a data or template
 * problem is returned as an unsupported / not-ready preview with a reason.
 */
export async function resolveAutomationAudience(
  rule: AutomationRule,
  opts: ResolveAudienceOptions = {},
): Promise<AudiencePreview> {
  const base: AudiencePreview = {
    supported: false,
    templateReady: false,
    previewBody: "",
    recipients: [],
    skipped: [],
    audienceNote: "",
  };
  if (rule.actionType !== "whatsapp_template") {
    return { ...base, reason: `Action "${rule.actionType}" is not automated on the server yet` };
  }
  if (!rule.audienceKey) {
    return {
      ...base,
      reason: "Audience is a free-text description — pick a preset audience (e.g. Overdue fee households) so the server can build the list",
    };
  }
  if (!SERVER_SUPPORTED_AUDIENCES.has(rule.audienceKey)) {
    return {
      ...base,
      reason: `Audience "${presetLabel(rule.audienceKey)}" is not automated on the server yet`,
    };
  }
  if (!rule.templateFamilyKey) {
    return { ...base, reason: "No WhatsApp template family linked to this rule" };
  }

  try {
    return await resolveFeeAudience(rule, opts);
  } catch (e) {
    return {
      ...base,
      reason: `Could not build the audience: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function resolveFeeAudience(
  rule: AutomationRule,
  opts: ResolveAudienceOptions,
): Promise<AudiencePreview> {
  const now = opts.now || new Date();
  const skipped: AutomationSkipNote[] = [];
  const preview: AudiencePreview = {
    supported: true,
    templateReady: false,
    previewBody: "",
    recipients: [],
    skipped,
    audienceNote: "",
  };

  // 1. Template — both languages, or nothing.
  const read = await approvedTemplatesServer("fees");
  if (!read.ok) {
    return { ...preview, templateError: `Could not read WhatsApp templates: ${read.error}` };
  }
  const picked = templatesByLanguage(read.templates, [rule.templateFamilyKey]);
  if (!picked.ready) {
    const missing = picked.missing.map((l) => (l === "en" ? "English" : "Hindi")).join(" and ");
    return {
      ...preview,
      templateError: `Template "${rule.templateFamilyKey}" is not approved in ${missing || "either language"} — finish it in Masters → WhatsApp templates`,
    };
  }
  preview.templateReady = true;
  const bodyByLang: Record<string, string> = {};
  for (const t of read.templates) {
    if (t.familyKey === rule.templateFamilyKey) bodyByLang[t.language] = t.body;
  }

  // 2. Families.
  const ctx = await loadFeeContext();
  const defaulters = listLiveDefaulters({
    asOf: ctx.todayIso,
    academicYearCode: ctx.academicYearCode,
    includeUpcoming: rule.audienceKey === "fee_due_soon",
    sis: ctx.sis,
    masters: ctx.masters,
  });
  const rows =
    rule.audienceKey === "fee_overdue"
      ? defaulters.filter((d) => d.overdueDays > 0)
      : defaulters.filter((d) => d.overdueDays <= 0 && d.overdueDays >= -DUE_SOON_DAYS);

  // One message per family: siblings share a household, the amount is
  // the household's, and the message names the eldest-first child.
  const byHousehold = new Map<string, LiveDefaulter[]>();
  for (const d of rows) {
    const list = byHousehold.get(d.householdId) || [];
    list.push(d);
    byHousehold.set(d.householdId, list);
  }

  const ledger = opts.ignoreCap ? {} : await loadAutomationSendLedger();
  const householdsById = new Map<string, Household>(ctx.sis.households.map((h) => [h.id, h]));
  const candidates: { recipient: AutomationRecipient; hh: Household }[] = [];
  let noMobile = 0;
  let tooSoon = 0;
  let familyQuiet = 0;

  for (const [householdId, kids] of byHousehold) {
    const hh = householdsById.get(householdId);
    const mobile = hh ? householdWhatsApp(hh) || hh.mobile || "" : "";
    if (!hh || !mobile) {
      noMobile += 1;
      continue;
    }
    if (rule.minDaysBetween > 0 && !opts.ignoreCap) {
      const ago = daysSince(ledger[householdId], ctx.todayIso);
      if (ago !== null && ago < rule.minDaysBetween) {
        tooSoon += 1;
        continue;
      }
    }
    if (inFamilyQuietHours(hh, now)) {
      familyQuiet += 1;
      continue;
    }
    const lead = kids[0]!;
    const amountPaise = kids.reduce(
      (s, k) => s + (rule.audienceKey === "fee_overdue" ? k.overdueAmountPaise : k.openAmountPaise),
      0,
    );
    const language = waTemplateLanguageFor(hh);
    const tpl = picked.byLang[language] ?? picked.ready;
    const childName =
      kids.length > 1 ? `${lead.fullName} +${kids.length - 1}` : lead.fullName;
    const cls = classLabel(ctx.masters, lead.student.classId, lead.student.sectionId).replace(" · ", " ");
    const variables: Record<string, string> = {
      schoolName: TENANT.nameDisplay,
      guardianName: hh.guardianName || "Parent",
      childName,
      classLabel: cls,
      stage: stageWord(lead),
      feeDue: formatInr(amountPaise),
      amount: formatInr(amountPaise),
      overdueDays: String(Math.max(0, lead.overdueDays)),
      dueOn: lead.earliestDueOn,
      payLink: `https://${TENANT.publicPortal || "bhbinternational.school"}/parent`,
    };
    candidates.push({
      hh,
      recipient: {
        mobile,
        fallbackMobile: hh.altMobile || undefined,
        householdId,
        studentId: lead.studentId,
        studentName: childName,
        classLabel: cls,
        amountPaise,
        language,
        body: fillTemplateBody(bodyByLang[language] || bodyByLang.en || "", variables),
        templateName: tpl.metaName,
        templateLanguage: tpl.language,
        variableKeys: tpl.variables,
        variables,
      },
    });
  }

  // 3. STOP.
  const optedOut = await listOptedOutSet(candidates.map((c) => c.recipient.mobile)).catch(
    () => new Set<string>(),
  );
  let stopped = 0;
  let recipients = candidates
    .filter((c) => {
      if (optedOut.has(toE164India(c.recipient.mobile))) {
        stopped += 1;
        return false;
      }
      return true;
    })
    .map((c) => c.recipient);

  // 4. Cap per run — biggest / oldest dues first (listLiveDefaulters order).
  let capped = 0;
  if (recipients.length > rule.maxPerRun) {
    capped = recipients.length - rule.maxPerRun;
    recipients = recipients.slice(0, rule.maxPerRun);
  }

  if (noMobile) skipped.push({ reason: "without a WhatsApp number", count: noMobile });
  if (tooSoon) skipped.push({ reason: `reminded in the last ${rule.minDaysBetween} days`, count: tooSoon });
  if (familyQuiet) skipped.push({ reason: "in their own quiet hours", count: familyQuiet });
  if (stopped) skipped.push({ reason: "opted out (STOP)", count: stopped });
  if (capped) skipped.push({ reason: `held for the next run (cap ${rule.maxPerRun})`, count: capped });

  const langCounts: Record<string, number> = {};
  for (const r of recipients) langCounts[r.language || "en"] = (langCounts[r.language || "en"] || 0) + 1;
  const langNote = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `${n} in ${l.toUpperCase()}`)
    .join(", ");
  const totalPaise = recipients.reduce((s, r) => s + (r.amountPaise || 0), 0);
  const bits = [
    `${recipients.length} famil${recipients.length === 1 ? "y" : "ies"}${langNote ? ` (${langNote})` : ""}`,
  ];
  if (recipients.length) bits.push(`${formatInr(totalPaise)} outstanding`);
  for (const s of skipped) bits.push(`${s.count} ${s.reason}`);
  preview.audienceNote = bits.join(" · ");
  preview.recipients = recipients;
  preview.previewBody = recipients[0]?.body || fillTemplateBody(bodyByLang.en || "", {});
  return preview;
}
