/**
 * The staff app's Broadcast screen, on the web's send path (20 Oct 2026,
 * requests mr_mva0gr5aop3y "template or custom message" and
 * mr_mva0ik2uqmoy "audience selector").
 *
 * GET  — what this person may aim at (school-wide audiences only with the
 *        web's broadcast permission; otherwise their own sections), the
 *        approved template families, and whether the custom-message
 *        template (comms_notice) is ready.
 * POST — { audience, mode: "template"|"custom", templateFamilyKey?,
 *          variables?, text?, title?, channel: "whatsapp"|"app",
 *          dryRun, confirmCount?, sendId? }
 *
 * The audience is resolved by `resolveWaAudience` — the web's resolver, so
 * de-duplication by family, STOP, known-dead numbers and per-family
 * language are the same rules — and sent by `sendTemplateToAudience` /
 * `sendTextToAudience` through /api/wa/dispatch (chunks of 100, quiet
 * hours, number failover, delivery log). There is no second sender here.
 *
 * A custom message goes as free text only to numbers inside their 24-hour
 * window; everyone else gets it inside the approved "School notice"
 * template. The dry run says how many go each way and what it should cost.
 *
 * A live send needs the count the dry run showed (`confirmCount`, 409 when
 * the audience moved) and a client-made `sendId`, claimed once in
 * wa_send_claims so a double tap cannot send twice.
 */

import { ApiError, apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth, type ApiAuthContext } from "@/lib/api/v1/auth";
import {
  assertMobileFeature,
  hasMobileFeature,
} from "@/lib/api/v1/mobileAccess.server";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import { hasPermission } from "@/lib/rbac";
import { parseWaAudienceSpec, type WaAudienceSpec } from "@/lib/waAudienceSpec";
import { resolveWaAudience } from "@/lib/waAudienceResolve.server";
import {
  sendTemplateToAudience,
  sendTextToAudience,
  type WaAudienceSendResult,
} from "@/lib/waAudienceSend.server";
import { listOpenWindowSet } from "@/lib/waContactState.server";
import { loadWaTemplatesServer } from "@/lib/waTemplatesRead.server";
import {
  resolveTemplateForSend,
  templateFamilyReady,
  WA_TEMPLATE_VARIABLES,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { loadWaCostRates } from "@/lib/waCostRates.server";
import { ratesAreDefaults } from "@/lib/waUsageCost";
import {
  authorizeBroadcastAudience,
  billCategoryOfTemplate,
  broadcastClaimKey,
  CUSTOM_MESSAGE_MAX,
  CUSTOM_MESSAGE_TEMPLATE_FAMILY,
  customFreeText,
  customTemplateVariables,
  estimateBroadcastPaise,
  splitCustomMessage,
} from "@/lib/staffAppBroadcast";
import { claimSendOnce } from "@/lib/waSendClaim.server";
import { sendPushToSubjects } from "@/lib/webPush.server";
import { appendStaffBroadcast } from "@/lib/staffBroadcastLog.server";
import { ensureTransportHydratedServer } from "@/lib/transportPersistence";
import { loadTransport } from "@/lib/transport";
import { stageLabel } from "@/lib/playbook";
import type { OverdueStage } from "@/lib/types";
import { TENANT } from "@/lib/types";
import { chatSelfFromSession } from "@/lib/erpChat";
import { loadSisForStaff } from "@/lib/sis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Variables the resolver fills per recipient — never asked of the sender. */
const AUTO_VARIABLES = new Set([
  "guardianName",
  "childName",
  "classLabel",
  "staffName",
  "schoolName",
]);

/**
 * The Broadcast feature, or (for a teacher) "Message my classes". Either
 * opens the screen; the AUDIENCE is what the second one restricts.
 */
function assertBroadcastFeature(ctx: ApiAuthContext): void {
  if (hasMobileFeature(ctx, "broadcast")) return;
  if (hasMobileFeature(ctx, "class_broadcast")) return;
  assertMobileFeature(ctx, "broadcast");
}

/** School-wide aim: the app's Broadcast feature AND the web's broadcast grant. */
function isSchoolWide(ctx: ApiAuthContext): boolean {
  return (
    hasMobileFeature(ctx, "broadcast") &&
    hasPermission(ctx.session, ctx.masters, "notifications", "edit", ctx.rbac)
  );
}

function sectionLabelOf(ctx: ApiAuthContext, sectionId: string): string {
  const sec = ctx.masters.sections.find((s) => s.id === sectionId);
  const cls = ctx.masters.classes.find((c) => c.id === sec?.classId);
  return [cls?.name, sec?.name].filter(Boolean).join("-") || sectionId;
}

async function authorize(ctx: ApiAuthContext, spec: WaAudienceSpec) {
  const schoolWide = isSchoolWide(ctx);
  const scope = schoolWide ? null : await staffSectionScope(ctx);
  return authorizeBroadcastAudience(spec, {
    // A school-wide SCOPE (principal, office) lets every section through
    // mayMessageSection; only the broadcast permission opens the
    // school-wide audiences.
    schoolWide,
    mayMessageSection: (sectionId) => {
      const sec = ctx.masters.sections.find((s) => s.id === sectionId);
      return !!sec && !!scope && scopeAllows(scope, sec.classId, sec.id);
    },
    sectionsOfClass: (classId) =>
      ctx.masters.sections.filter((s) => s.classId === classId).map((s) => s.id),
    sectionLabel: (id) => sectionLabelOf(ctx, id),
  });
}

/** Approved families the app can send: both languages, text header only. */
function sendableFamilies(state: WaTemplatesState) {
  const labels = new Map(WA_TEMPLATE_VARIABLES.map((v) => [v.key, v.label]));
  const byFamily = new Map<string, WaTemplatesState["templates"]>();
  for (const t of state.templates) {
    if (t.status !== "approved" || t.paused) continue;
    const list = byFamily.get(t.familyKey) ?? [];
    list.push(t);
    byFamily.set(t.familyKey, list);
  }
  const out = [];
  for (const [familyKey, list] of byFamily) {
    if (!templateFamilyReady(state, familyKey).ready) continue;
    const en = list.find((t) => t.language === "en");
    const hi = list.find((t) => t.language === "hi");
    if (!en || !hi) continue;
    // A media header needs a file the phone cannot attach.
    if (list.some((t) => t.headerFormat && t.headerFormat !== "TEXT" && t.headerFormat !== "NONE")) continue;
    // One-time passwords are approved but nothing anyone broadcasts.
    if (en.category === "AUTHENTICATION" || /otp/i.test(en.metaName)) continue;
    out.push({
      familyKey,
      name: en.name,
      module: en.module,
      category: en.category,
      bodyEn: en.body,
      bodyHi: hi.body,
      variables: en.variables.map((key) => ({
        key,
        label: labels.get(key) || key,
        auto: AUTO_VARIABLES.has(key),
      })),
    });
  }
  return out.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveApiAuth(req);
    assertBroadcastFeature(ctx);
    const schoolWide = isSchoolWide(ctx);
    const scope = schoolWide ? null : await staffSectionScope(ctx);
    // Every section for a school-wide scope; school-wide AUDIENCES only
    // with the broadcast permission.
    const allSections = schoolWide || !!scope?.unrestricted;

    const classes = ctx.masters.classes
      .map((c) => ({
        id: c.id,
        name: c.name,
        sections: ctx.masters.sections
          .filter((s) => s.classId === c.id)
          .filter((s) => allSections || (!!scope && scopeAllows(scope, c.id, s.id)))
          .map((s) => ({ id: s.id, name: s.name, label: `${c.name}-${s.name}` })),
      }))
      .filter((c) => c.sections.length);

    let routes: { id: string; label: string }[] = [];
    if (schoolWide) {
      await ensureTransportHydratedServer().catch(() => false);
      routes = (loadTransport().routes ?? [])
        .filter((r) => r.isActive !== false)
        .map((r) => ({ id: r.id, label: r.name || r.code || r.id }));
    }

    // null = could not read the registry: "not loaded", never "no templates".
    let templates: ReturnType<typeof sendableFamilies> | null = null;
    let customReady: boolean | null = null;
    try {
      const state = await loadWaTemplatesServer();
      templates = sendableFamilies(state);
      customReady = templateFamilyReady(state, CUSTOM_MESSAGE_TEMPLATE_FAMILY).ready;
    } catch {
      templates = null;
    }

    return apiOk({
      schoolWide,
      classes,
      designations: schoolWide
        ? (ctx.masters.designations ?? []).map((d) => ({ id: d.id, name: d.name }))
        : [],
      routes,
      feeStages: schoolWide
        ? (["S1", "S2", "S3", "S4"] as OverdueStage[]).map((s) => ({ id: s, label: stageLabel(s) }))
        : [],
      templates,
      customTemplateReady: customReady,
      customMax: CUSTOM_MESSAGE_MAX,
    });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = {
  audience?: unknown;
  mode?: string;
  templateFamilyKey?: string;
  variables?: Record<string, string>;
  text?: string;
  title?: string;
  channel?: string;
  dryRun?: boolean;
  confirmCount?: number;
  sendId?: string;
};

function cleanVars(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (AUTO_VARIABLES.has(k)) continue; // the resolver's, per recipient
    if (typeof v === "string") out[k] = v.trim().slice(0, 500);
  }
  return out;
}

/** Template body for the app notification, with the sender's values in. */
function renderForPush(body: string, vars: Record<string, string>): string {
  const filled = (body || "")
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
      k === "schoolName" ? TENANT.nameDisplay : vars[k] ?? (k === "guardianName" ? "Parent" : ""),
    )
    .replace(/\*([^*]+)\*/g, "$1");
  return filled.trim();
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveApiAuth(req);
    assertBroadcastFeature(ctx);

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      throw new ApiError("bad_request", "Invalid JSON", 400);
    }

    const parsed = parseWaAudienceSpec(body.audience);
    if (!parsed.ok) throw new ApiError("bad_request", parsed.error, 400);
    const spec = parsed.spec;

    const allowed = await authorize(ctx, spec);
    if (!allowed.ok) throw new ApiError("forbidden", allowed.error, allowed.status);

    const mode = body.mode === "custom" ? "custom" : body.mode === "template" ? "template" : "";
    if (!mode) throw new ApiError("bad_request", 'mode must be "template" or "custom"', 400);
    const channel = body.channel === "app" ? "app" : "whatsapp";
    const senderName = ctx.session.fullName || "";
    const text = String(body.text || "").trim();
    const title = String(body.title || "").trim().slice(0, 80);
    const variables = cleanVars(body.variables);
    let familyKey = "";

    if (mode === "custom") {
      if (!text) throw new ApiError("bad_request", "Type the message first", 400);
      if (text.length > CUSTOM_MESSAGE_MAX) {
        throw new ApiError("bad_request", `At most ${CUSTOM_MESSAGE_MAX} characters`, 400);
      }
      familyKey = CUSTOM_MESSAGE_TEMPLATE_FAMILY;
    } else {
      familyKey = String(body.templateFamilyKey || "").trim();
      if (!familyKey) throw new ApiError("bad_request", "Choose a template", 400);
    }

    const resolved = await resolveWaAudience(spec, {
      academicYearCode: ctx.session.academicYearCode,
    });
    if (!resolved.ok) {
      throw new ApiError("server_error", resolved.error || "Could not work out the audience", 502);
    }

    // Templates: read once. A failed read is not "no template" — refuse.
    let state: WaTemplatesState;
    try {
      state = await loadWaTemplatesServer();
    } catch (e) {
      throw new ApiError(
        "server_error",
        e instanceof Error ? `Could not read WhatsApp templates: ${e.message}` : "Could not read WhatsApp templates",
        502,
      );
    }
    const familyTemplates = state.templates.filter((t) => t.familyKey === familyKey);
    if (mode === "template" && !sendableFamilies(state).some((f) => f.familyKey === familyKey)) {
      throw new ApiError(
        "bad_request",
        "That template is not approved in both Hindi and English, or needs a file the app cannot attach",
        400,
      );
    }
    if (mode === "template") {
      const missing = (familyTemplates.find((t) => t.language === "en")?.variables ?? []).filter(
        (k) => !AUTO_VARIABLES.has(k) && !variables[k],
      );
      if (missing.length) {
        throw new ApiError("bad_request", `Fill every template field first (${missing.join(", ")})`, 400);
      }
    }

    // ── Who gets what ────────────────────────────────────────────────────
    const recipients = channel === "app" ? [] : resolved.recipients;
    let windowKnown = true;
    let freeText = [] as typeof recipients;
    let viaTemplate = recipients;
    if (mode === "custom" && recipients.length) {
      const win = await listOpenWindowSet(recipients.flatMap((r) => [r.mobile, r.fallbackMobile || ""]));
      windowKnown = win.ok;
      ({ freeText, viaTemplate } = splitCustomMessage(recipients, win.open));
    }
    // Recipients whose language has no approved template cannot be reached.
    const noTemplate = viaTemplate.filter(
      (r) => !resolveTemplateForSend({ state, familyKey, language: r.language }).ok,
    ).length;

    const category = billCategoryOfTemplate(familyTemplates[0]?.category || "");
    const rates = await loadWaCostRates().catch(() => null);
    const estimate = rates
      ? {
          paise: estimateBroadcastPaise({
            freeText: freeText.length,
            viaTemplate: viaTemplate.length - noTemplate,
            templateCategory: category,
            rates,
          }),
          gstPct: rates.gstPct,
          ratesConfirmed: !ratesAreDefaults(rates),
        }
      : null;

    const confirmTotal = channel === "app" ? resolved.audienceRefIds.length : recipients.length;
    const summary = {
      audienceLabel: resolved.label,
      wholeSchool: resolved.wholeSchool,
      channel,
      messageMode: mode,
      families: resolved.audienceRefIds.length,
      recipientCount: confirmTotal,
      viaFreeText: freeText.length,
      viaTemplate: viaTemplate.length - noTemplate,
      cannotReach: noTemplate,
      windowKnown,
      skippedOptOut: resolved.skippedOptOut,
      skippedNotOnWhatsApp: resolved.skippedNotOnWhatsApp,
      skippedNoNumber: resolved.skippedNoNumber,
      templateCategory: category,
      estimate,
      sample: resolved.recipients.slice(0, 8).map((r) => r.name),
    };

    if (body.dryRun !== false) {
      return apiOk({ mode: "dry_run", ...summary });
    }

    // ── Live ─────────────────────────────────────────────────────────────
    if (!confirmTotal) throw new ApiError("bad_request", "Nobody in this audience can be reached", 400);
    if (typeof body.confirmCount !== "number") {
      throw new ApiError("bad_request", "Check the recipients first (confirmCount missing)", 400);
    }
    if (body.confirmCount !== confirmTotal) {
      throw new ApiError(
        "conflict",
        `The audience changed since you checked it — now ${confirmTotal}, you approved ${body.confirmCount}. Check it again before sending.`,
        409,
      );
    }
    const claimKey = broadcastClaimKey(String(body.sendId || ""));
    if (!claimKey) throw new ApiError("bad_request", "sendId is required for a live send", 400);
    const claim = await claimSendOnce(claimKey, senderName || ctx.session.staffId || "staff", resolved.label, {
      neverStale: true,
    });
    if (!claim.ok) {
      throw new ApiError(
        claim.reason === "held" ? "conflict" : "server_error",
        claim.reason === "held"
          ? "This message was already sent (or is being sent) — nothing was sent twice."
          : `Nothing was sent: ${claim.message}`,
        claim.reason === "held" ? 409 : 503,
      );
    }

    const origin = req.url;
    const empty: WaAudienceSendResult = { sent: 0, failed: 0, deferred: 0, skippedNoTemplate: 0, error: "" };
    let textRes = empty;
    let tplRes = empty;
    if (channel === "whatsapp") {
      if (mode === "custom") {
        textRes = await sendTextToAudience({
          recipients: freeText,
          text: customFreeText(text, senderName),
          originUrl: origin,
          audienceKind: spec.kind,
        });
        tplRes = viaTemplate.length
          ? await sendTemplateToAudience({
              recipients: viaTemplate,
              familyKey,
              variables: customTemplateVariables(text, title, senderName),
              originUrl: origin,
              audienceKind: spec.kind,
            })
          : empty;
      } else {
        tplRes = await sendTemplateToAudience({
          recipients: viaTemplate,
          familyKey,
          variables,
          originUrl: origin,
          audienceKind: spec.kind,
        });
      }
    }

    // App notification — free; the only channel when "app" was chosen.
    const isStaff = spec.kind === "staff";
    const pushText =
      mode === "custom"
        ? customFreeText(text, senderName)
        : renderForPush(
            familyTemplates.find((t) => t.language === (isStaff ? "en" : "hi"))?.body || "",
            variables,
          );
    let push = { sent: 0, expired: 0, failed: 0 };
    if (pushText) {
      push = await sendPushToSubjects(isStaff ? "staff" : "parent", resolved.audienceRefIds, {
        title: `${senderName || "School"} · ${TENANT.nameDisplay}`,
        body: pushText.length > 200 ? `${pushText.slice(0, 197)}…` : pushText,
        url: "/notices",
        data: { kind: "broadcast", fullText: pushText.slice(0, 3000), sender: senderName },
      }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
    }

    const sent = textRes.sent + tplRes.sent;
    const failed = textRes.failed + tplRes.failed;
    // The same staff record "Message my classes" logs under, so a person's
    // sends read back together.
    const actorStaffId =
      chatSelfFromSession(ctx.session, ctx.masters, loadSisForStaff())?.staffId ||
      ctx.session.staffId ||
      "";
    await appendStaffBroadcast({
      id: `sb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      staffId: actorStaffId,
      staffName: senderName,
      audience: "audience",
      audienceLabel: resolved.label,
      mode,
      viaFreeText: freeText.length,
      viaTemplate: viaTemplate.length,
      sectionIds: spec.kind === "parents" ? spec.sectionIds ?? [] : [],
      sectionLabels: spec.kind === "parents" ? (spec.sectionIds ?? []).map((id) => sectionLabelOf(ctx, id)) : [],
      body: mode === "custom" ? text.slice(0, 3000) : "",
      templateName: mode === "template" ? familyKey : channel === "whatsapp" && viaTemplate.length ? familyKey : "",
      families: resolved.audienceRefIds.length,
      recipientCount: recipients.length,
      skippedOptOut: resolved.skippedOptOut,
      sent,
      failed,
      pushSent: push.sent,
    }).catch(() => false);

    return apiOk({
      mode: "live",
      ...summary,
      sent,
      failed,
      deferred: textRes.deferred + tplRes.deferred,
      skippedNoTemplate: textRes.skippedNoTemplate + tplRes.skippedNoTemplate,
      push,
      error: textRes.error || tplRes.error || undefined,
    });
  } catch (e) {
    return apiErr(e);
  }
}
