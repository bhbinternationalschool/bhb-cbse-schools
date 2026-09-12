/**
 * Sending the 6 PM brief.
 *
 * Recipients are resolved with staffHomeKind — the same classifier the app
 * uses to decide who lands on /principal — so "leadership" means here what
 * it means everywhere else in the ERP: a role or designation matching
 * principal, director, trustee, head master, chairman, secretary, manager,
 * owner. Nobody maintains a second list of who counts as leadership, which
 * is the list that would quietly go stale.
 *
 * The PDF is attached by URL rather than uploaded: a template send needs a
 * link Meta can fetch, and dailyBriefLinkToken signs one for five minutes
 * against that date. The document is built once and the same signed URL
 * goes to everyone, so five recipients cost one render.
 */

import "server-only";

import { loadServerMasters } from "@/lib/api/v1/auth";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { staffHomeKind } from "@/lib/staffHomeKind";
import { fetchServerBlob } from "@/lib/serverBlob";
import { sendWhatsAppTemplate } from "@/lib/waSend";
import {
  normalizeWaTemplatesState,
  resolveTemplateForSend,
  templateVariablePositions,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import {
  briefFilename,
  briefTemplateProblems,
  composeBriefTemplateVariables,
  type DailyBrief,
} from "@/lib/dailyBrief";
import { buildDailyBrief, istToday } from "@/lib/dailyBrief.server";
import { signBriefLinkToken } from "@/lib/dailyBriefLinkToken.server";
import { generateBriefPendingNote } from "@/lib/dailyBriefAi.server";

const FAMILY_KEY = "leadership_daily_brief";

export type BriefRecipient = { staffId: string; name: string; mobile: string; designation: string };

export type BriefSendResult = {
  ok: boolean;
  date: string;
  recipients: number;
  sent: number;
  failed: number;
  skipped: string[];
  error?: string;
};

function publicOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() ||
    "https://bhbinternational.school"
  );
}

function ten(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  const t = d.length > 10 ? d.slice(-10) : d;
  return t.length === 10 && /^[6-9]/.test(t) ? t : "";
}

/** Who the brief goes to, by the ERP's own definition of leadership. */
export async function briefRecipients(): Promise<BriefRecipient[]> {
  const masters = await loadServerMasters();
  const designations = new Map(
    (masters.designations ?? []).map((d) => [d.id, d.name || ""]),
  );
  const out: BriefRecipient[] = [];
  const seen = new Set<string>();
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    const designation = designations.get(s.designationId || "") || "";
    // StaffRecord carries no roleCode — that lives on the login session,
    // not the roster — so leadership is decided from the DESIGNATION,
    // which is the signal a roster actually holds. staffHomeKind matches
    // principal, director, trustee, head master, vice principal, chairman,
    // secretary and manager on it.
    const kind = staffHomeKind({
      roleCode: "",
      designation,
      stream: s.stream || "",
      teachesClasses: false,
    });
    if (kind !== "leadership") continue;
    // Their own number, then the alternate — the same fall-through every
    // other sender uses. A leader with no number on file is reported as a
    // skip rather than silently dropped.
    const mobile = ten(s.mobile || "") || ten(s.altMobile || "");
    if (!mobile || seen.has(mobile)) continue;
    seen.add(mobile);
    out.push({ staffId: s.id, name: s.fullName || s.id, mobile, designation });
  }
  return out;
}

export async function sendDailyBrief(
  opts: { dateIso?: string; dryRun?: boolean } = {},
): Promise<BriefSendResult> {
  const date = opts.dateIso || istToday();
  const skipped: string[] = [];

  const recipients = await briefRecipients();
  if (recipients.length === 0) {
    return {
      ok: false,
      date,
      recipients: 0,
      sent: 0,
      failed: 0,
      skipped: ["no active staff member matches leadership with a mobile on file"],
      error: "no recipients",
    };
  }

  // The AI paragraph is the one part allowed to fail without stopping the
  // brief: a note about loose ends is worth having and is not worth losing
  // the day's numbers over. generateBriefPendingNote already falls back to
  // the deterministic list, so this catch is the belt to that braces.
  let brief: DailyBrief;
  try {
    const base = await buildDailyBrief({ dateIso: date });
    const aiNote = await generateBriefPendingNote(base).catch(() => "");
    brief = { ...base, aiNote };
  } catch (e) {
    return {
      ok: false,
      date,
      recipients: recipients.length,
      sent: 0,
      failed: 0,
      skipped,
      error: e instanceof Error ? e.message : "could not build the brief",
    };
  }

  const values = composeBriefTemplateVariables(brief);
  const problems = briefTemplateProblems(values);
  if (problems.length) {
    // Meta would refuse this and the only symptom would be a quiet
    // evening, so it is refused here with a reason somebody can read.
    return {
      ok: false,
      date,
      recipients: recipients.length,
      sent: 0,
      failed: 0,
      skipped,
      error: `template values Meta would refuse: ${problems
        .map((p) => `${p.key} ${p.problem}`)
        .join("; ")}`,
    };
  }

  const signed = signBriefLinkToken(date);
  if (!signed) {
    return {
      ok: false,
      date,
      recipients: recipients.length,
      sent: 0,
      failed: 0,
      skipped,
      error: "no signing secret — the PDF could not be linked",
    };
  }
  const documentUrl = `${publicOrigin().replace(/\/+$/, "")}/api/reports/daily-brief?d=${date}&exp=${signed.exp}&sig=${encodeURIComponent(signed.sig)}`;

  const { state: raw } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
  const templates = normalizeWaTemplatesState(raw);

  if (opts.dryRun) {
    return {
      ok: true,
      date,
      recipients: recipients.length,
      sent: 0,
      failed: 0,
      skipped: [`dry run — would send to ${recipients.map((r) => r.name).join(", ")}`],
    };
  }

  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    const language = waTemplateLanguageFor({});
    const resolved = resolveTemplateForSend({
      state: templates,
      familyKey: FAMILY_KEY,
      language,
    });
    if (!resolved.ok) {
      skipped.push(`${r.name}: ${resolved.reason}`);
      continue;
    }
    const positions = templateVariablePositions(resolved.template, values);
    const hasMediaHeader =
      resolved.template.headerFormat === "DOCUMENT" ||
      resolved.template.headerFormat === "IMAGE" ||
      resolved.template.headerFormat === "VIDEO";
    if (!hasMediaHeader) {
      // Said once per recipient, loudly, because the numbers still go out and
      // the body says the full brief is attached — which it is not until the
      // template carries a real DOCUMENT header on Meta.
      console.error(
        `[daily-brief] ${resolved.template.metaName}/${resolved.template.language} has no media header on Meta — ` +
          "the brief is sending WITHOUT its PDF. Re-submit the template with a document example " +
          "(scripts/wa-submit-media-templates.mts) to attach it again.",
      );
    }
    const res = await sendWhatsAppTemplate({
      toMobile: r.mobile,
      name: resolved.template.metaName,
      language: resolved.template.metaLanguage || resolved.template.language,
      fromPhoneNumberId: resolved.sender?.phoneNumberId,
      // A header parameter for a template Meta approved WITHOUT a header is
      // refused as "(#132018) There's an issue with the parameters in your
      // template" — which is how the 6 PM brief failed silently from the day
      // it was scheduled. The seed asked for a DOCUMENT header; the submit
      // path drops a media header when it has no example file to send with
      // it, so Meta holds this template with a body and a footer and nothing
      // else. Send the shape that was actually approved.
      components: [
        ...(hasMediaHeader
          ? [
              {
                type: "header" as const,
                parameters: [
                  { type: "document" as const, document: { link: documentUrl, filename: briefFilename(date) } },
                ],
              },
            ]
          : []),
        {
          type: "body",
          parameters: Object.keys(positions)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => ({ type: "text", text: positions[k]! })),
        },
      ],
      // One brief per person per day: a re-run of the cron must not send a
      // second copy.
      clientMessageId: `dailybrief:${date}:${r.mobile}`,
    });
    if (res.ok) sent++;
    else {
      failed++;
      skipped.push(`${r.name}: ${res.error || "send failed"}`);
    }
    await logHouseholdWaSend({
      mobile: r.mobile,
      purpose: "daily_brief",
      via: "template",
      templateName: resolved.template.metaName,
      preview: values.collection,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? "" : res.error || "",
      waMessageId: res.ok ? res.providerId || "" : "",
    }).catch(() => undefined);
  }

  return { ok: sent > 0, date, recipients: recipients.length, sent, failed, skipped };
}
