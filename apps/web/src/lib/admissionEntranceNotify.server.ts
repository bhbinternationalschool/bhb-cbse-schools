/**
 * Admissions → Entrance test → Notify families: preview, then send.
 *
 * The audience is worked out HERE from the roll and the current lead
 * records — the browser sends candidate ids, never phone numbers. Each
 * family gets the approved template in its own language (Hindi unless the
 * family chose otherwise — waTemplateLanguageFor), through the one sender
 * the ERP uses for template sends (waAudienceSend → /api/wa/dispatch), so
 * quiet hours, number failover and the delivery log all apply.
 *
 * The two template families (admissions_entrance_invite / _result) are new
 * in the seed catalogue. Until BOTH languages are approved on Meta the
 * preview shows the text and the send is refused before anything leaves —
 * there is no free-text fallback here, by design.
 */

import "server-only";

import { TENANT } from "@/lib/types";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import {
  seedTemplateText,
  templateFamilyReady,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { loadWaTemplatesServer } from "@/lib/waTemplatesRead.server";
import {
  ENTRANCE_INVITE_FAMILY,
  ENTRANCE_RESULT_FAMILY,
  entranceMessageVars,
  fillTemplateBody,
  tenDigitMobile,
  type EntranceNotifyKind,
} from "@/lib/admissionEntranceTest";
import {
  EntranceTestError,
  classNamesServer,
  fetchLeadsByIds,
  getSessionBundle,
  markNotified,
} from "@/lib/admissionEntranceTest.server";

export type NotifyPlanRow = {
  candidateId: string;
  rollNo: string;
  childName: string;
  /** Last four digits only — the preview is a check, not a phone book. */
  mobileTail: string;
  language: "en" | "hi";
  text: string;
  /** "" = will be sent; otherwise why not. */
  skipReason: string;
};

export type NotifyPlan = {
  kind: EntranceNotifyKind;
  familyKey: string;
  /** Template state: approved in both languages, or why not. */
  templateReady: boolean;
  templateNote: string;
  rows: NotifyPlanRow[];
  sendable: number;
};

type Internal = NotifyPlan & {
  internal: {
    candidateId: string;
    mobile: string;
    language: "en" | "hi";
    vars: Record<string, string>;
    label: string;
  }[];
};

async function buildPlan(
  sessionId: string,
  kind: EntranceNotifyKind,
  candidateIds: string[],
  resend: boolean,
): Promise<Internal> {
  const familyKey = kind === "invite" ? ENTRANCE_INVITE_FAMILY : ENTRANCE_RESULT_FAMILY;
  const { session, candidates } = await getSessionBundle(sessionId);
  const want = new Set(candidateIds);
  const picked = candidates.filter((c) => want.has(c.id));
  if (picked.length === 0) throw new EntranceTestError("Tick the children whose families should be messaged.");

  let templates: WaTemplatesState | null = null;
  let templateNote = "";
  try {
    templates = await loadWaTemplatesServer();
  } catch (e) {
    // Could not read ≠ not approved. Say which it is.
    templateNote = `Could not read WhatsApp templates (${e instanceof Error ? e.message : "unknown error"}). Nothing can be sent until they load.`;
  }
  let templateReady = false;
  if (templates) {
    const ready = templateFamilyReady(templates, familyKey);
    templateReady = ready.ready;
    if (!ready.ready) {
      templateNote =
        `The “${familyKey}” template is not approved on WhatsApp yet ` +
        `(missing: ${ready.missing.map((l) => (l === "hi" ? "Hindi" : "English")).join(" and ")}). ` +
        `Submit it from Masters → WhatsApp templates; this screen sends once Meta approves both languages.`;
    }
  }

  const [leads, classNames] = await Promise.all([
    fetchLeadsByIds(picked.map((c) => c.leadId)),
    classNamesServer(),
  ]);

  const rows: NotifyPlanRow[] = [];
  const internal: Internal["internal"] = [];
  for (const c of picked.sort((a, b) => a.rollNo.localeCompare(b.rollNo, "en", { numeric: true }))) {
    const lead = leads.get(c.leadId);
    const language = waTemplateLanguageFor({ preferredLanguage: lead?.preferredLanguage });
    const rawMobile = lead
      ? (lead.whatsappSame ? lead.mobile : lead.whatsapp || lead.mobile) || c.mobile
      : c.mobile;
    const mobile = tenDigitMobile(rawMobile);
    const varsRes = entranceMessageVars(
      kind,
      session,
      {
        ...c,
        guardianName: lead?.whatsappDisplayName || lead?.guardianName || c.guardianName,
        childName: lead?.childName || c.childName,
      },
      {
        lang: language,
        className: classNames.get(c.classId) || "",
        schoolName: TENANT.nameDisplay,
      },
    );
    const registry = templates?.templates.find(
      (t) => t.familyKey === familyKey && t.language === language && t.status === "approved",
    );
    const body = registry?.body || seedTemplateText(familyKey, language)?.body || "";
    const vars = varsRes.ok ? varsRes.vars : {};
    let skipReason = "";
    const already = kind === "invite" ? c.inviteSentAt : c.resultSentAt;
    if (!varsRes.ok) skipReason = varsRes.error;
    else if (!mobile) skipReason = "No valid 10-digit mobile on the lead";
    else if (already && !resend) skipReason = `Already sent ${already.slice(0, 10)}`;
    rows.push({
      candidateId: c.id,
      rollNo: c.rollNo,
      childName: c.childName,
      mobileTail: mobile ? mobile.slice(-4) : "",
      language,
      text: fillTemplateBody(body, vars),
      skipReason,
    });
    if (!skipReason && mobile) {
      internal.push({
        candidateId: c.id,
        mobile,
        language,
        vars,
        label: `${c.childName} · roll ${c.rollNo}`,
      });
    }
  }

  return {
    kind,
    familyKey,
    templateReady,
    templateNote,
    rows,
    sendable: internal.length,
    internal,
  };
}

export async function previewNotify(
  sessionId: string,
  kind: EntranceNotifyKind,
  candidateIds: string[],
  resend: boolean,
): Promise<NotifyPlan> {
  const p = await buildPlan(sessionId, kind, candidateIds, resend);
  // Numbers stay on the server: the preview carries only the last four digits.
  return {
    kind: p.kind,
    familyKey: p.familyKey,
    templateReady: p.templateReady,
    templateNote: p.templateNote,
    rows: p.rows,
    sendable: p.sendable,
  };
}

export type NotifySendResult = {
  sent: number;
  deferred: number;
  failed: number;
  errors: string[];
};

/**
 * Send what the preview showed. Refused when the template is not approved,
 * or when the count the office approved no longer matches (a roll edit or a
 * result change between preview and send).
 */
export async function sendNotify(
  sessionId: string,
  kind: EntranceNotifyKind,
  candidateIds: string[],
  resend: boolean,
  confirmCount: number,
  originUrl: string,
): Promise<NotifySendResult> {
  const plan = await buildPlan(sessionId, kind, candidateIds, resend);
  if (!plan.templateReady) {
    throw new EntranceTestError(plan.templateNote || "The template is not approved yet — nothing was sent.", 409);
  }
  if (plan.sendable === 0) throw new EntranceTestError("Nobody in this selection can be messaged.");
  if (confirmCount !== plan.sendable) {
    throw new EntranceTestError(
      `The list changed since you previewed it — now ${plan.sendable} families, you approved ${confirmCount}. Preview again before sending.`,
      409,
    );
  }

  const { sendTemplateToAudience } = await import("@/lib/waAudienceSend.server");
  const out: NotifySendResult = { sent: 0, deferred: 0, failed: 0, errors: [] };
  // One family per call, so each family's own outcome is known and only a
  // family the sender confirmed is marked as messaged.
  for (const r of plan.internal) {
    const res = await sendTemplateToAudience({
      recipients: [
        {
          mobile: r.mobile,
          language: r.language,
          name: r.label,
          refId: `entrance_${kind}_${r.candidateId}`,
          variables: r.vars,
        },
      ],
      familyKey: plan.familyKey,
      variables: {},
      originUrl,
      audienceKind: "admissions_entrance",
    });
    out.sent += res.sent;
    out.deferred += res.deferred;
    out.failed += res.failed + res.skippedNoTemplate;
    if (res.error && out.errors.length < 5) out.errors.push(`${r.label}: ${res.error}`);
    if (res.sent > 0) {
      try {
        await markNotified(r.candidateId, kind);
      } catch (e) {
        // The message went; only the bookkeeping failed. Say so rather than
        // let the office send it twice without knowing.
        out.errors.push(
          `${r.label}: sent, but could not record it (${e instanceof Error ? e.message : "error"}) — do not resend`,
        );
      }
    }
  }
  return out;
}
