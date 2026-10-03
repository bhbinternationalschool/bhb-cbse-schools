import "server-only";

/**
 * WhatsApp template autopilot — the server side of lib/waTemplateAutopilot.ts.
 *
 *   holdTemplateSend      keep a message whose template is not approved
 *   runTemplateAutopilot  (hourly, and on Meta's status webhook) — submit
 *                         templates never sent to Meta, rewrite and resubmit
 *                         rejected ones, then send every held message whose
 *                         template is now approved, and drop those whose day
 *                         has come
 *
 * The approved/pending truth is the `wa_templates_state` registry that the
 * hourly Meta sync writes (lib/waTemplateSync.server.ts).
 */

import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";
import { getServerTenantContext } from "@/lib/serverTenant";
import { TENANT } from "@/lib/types";
import { isProtectedSuperAdminEmail } from "@/lib/superAdmin";
import { waNormalizeLocal10 } from "@/lib/waSend";
import {
  markTemplateEditedOnMeta,
  markTemplateSubmittedToMeta,
  normalizeWaTemplatesState,
  seedWaTemplates,
  templateButtonComponents,
  type WaTemplate,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import {
  composeExpiredNote,
  composeHeldAck,
  composeReleasedNote,
  composeRepairGaveUpNote,
  countRecipients,
  splitReleasable,
  templateAction,
  templateVariables,
  validateTemplateRewrite,
  type HeldRecipients,
  type RepairState,
} from "@/lib/waTemplateAutopilot";

/* ── Telling people ───────────────────────────────────────────────────── */

/** A note to one staff number: text, or the approved office template outside 24 h. */
export async function tellStaff(mobile10: string, text: string, key: string): Promise<void> {
  const to = waNormalizeLocal10(mobile10 || "");
  if (to.length !== 10) return;
  try {
    const { sendLeadershipDirect } = await import("@/lib/waRelay.server");
    await sendLeadershipDirect({
      toMobiles: [to],
      label: "School WhatsApp",
      senderName: TENANT.nameDisplay,
      sender10: "auto",
      code: key.slice(-4),
      text,
      clientKey: `autopilot:${key}`,
    });
  } catch (e) {
    console.warn("[wa-autopilot] note to staff failed", (e as Error)?.message);
  }
}

/** The director's number(s): the protected owner account, else a Director / Owner designation. */
export async function directorMobiles(): Promise<string[]> {
  const { loadServerMasters } = await import("@/lib/api/v1/auth");
  const masters = await loadServerMasters();
  const active = (masters.staff ?? []).filter(
    (s) => s.status === "active" && waNormalizeLocal10(s.mobile || "").length === 10,
  );
  let owners = active.filter((s) => isProtectedSuperAdminEmail(s.email));
  if (!owners.length) {
    const designation = (id: string) => (masters.designations ?? []).find((d) => d.id === id)?.name ?? "";
    owners = active.filter((s) => /\b(owner|director|chairman|founder)\b/i.test(designation(s.designationId || "")));
  }
  return owners.map((s) => waNormalizeLocal10(s.mobile));
}

/* ── The registry ─────────────────────────────────────────────────────── */

async function readRegistry(): Promise<WaTemplatesState | null> {
  const { state } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
  // No registry is not an empty one: never act, and never write, from nothing.
  return state ? normalizeWaTemplatesState(state) : null;
}

function approvedLanguages(state: WaTemplatesState, familyKey: string): string[] {
  return state.templates
    .filter((t) => t.familyKey === familyKey && t.status === "approved" && !t.paused)
    .map((t) => t.language);
}

function approvedTemplate(state: WaTemplatesState, familyKey: string, language: string): WaTemplate | null {
  return (
    state.templates.find(
      (t) => t.familyKey === familyKey && t.language === language && t.status === "approved" && !t.paused,
    ) ?? null
  );
}

/* ── 1. Hold ──────────────────────────────────────────────────────────── */

export async function holdTemplateSend(input: {
  familyKey: string;
  module: string;
  label: string;
  recipients: HeldRecipients;
  vars: Record<string, string>;
  requestedByName: string;
  requestedByMobile: string;
  expiresAt: string;
  /** Tell the sender it is held (default true). */
  ack?: boolean;
}): Promise<{ ok: true; id: string; held: number } | { ok: false; error: string }> {
  const held = countRecipients(input.recipients);
  if (!held) return { ok: false, error: "Nobody to hold it for" };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database not configured" };
  const { data, error } = await ctx.sb
    .from("wa_held_sends")
    .insert({
      tenant_id: ctx.tenantId,
      family_key: input.familyKey,
      module: input.module,
      label: input.label.slice(0, 120),
      recipients: input.recipients,
      vars: input.vars,
      status: "held",
      requested_by_name: input.requestedByName,
      requested_by_mobile: waNormalizeLocal10(input.requestedByMobile || ""),
      expires_at: input.expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message || "Could not hold the message" };
  const id = String((data as { id: string }).id);
  if (input.ack !== false) {
    await tellStaff(input.requestedByMobile, composeHeldAck({ label: input.label, held, expiresAt: input.expiresAt }), `held:${id}`);
  }
  return { ok: true, id, held };
}

/* ── 2. Release ───────────────────────────────────────────────────────── */

type HeldRow = {
  id: string;
  family_key: string;
  module: string;
  label: string;
  recipients: HeldRecipients;
  vars: Record<string, string>;
  status: string;
  requested_by_mobile: string;
  expires_at: string;
  updated_at: string;
  result: { sent?: number; failed?: number; optedOut?: number };
};

export type ReleaseSummary = { checked: number; sent: number; failed: number; expired: number; stuck: number };

export async function releaseHeldSends(state: WaTemplatesState): Promise<ReleaseSummary> {
  const out: ReleaseSummary = { checked: 0, sent: 0, failed: 0, expired: 0, stuck: 0 };
  const ctx = await getServerTenantContext();
  if (!ctx) return out;
  const { sb, tenantId } = ctx;
  const { data, error } = await sb
    .from("wa_held_sends")
    .select("id, family_key, module, label, recipients, vars, status, requested_by_mobile, expires_at, updated_at, result")
    .eq("tenant_id", tenantId)
    .in("status", ["held", "sending"])
    .order("created_at", { ascending: true })
    .limit(200);
  if (error || !data) {
    if (error) console.warn("[wa-autopilot] held read failed", error.message);
    return out;
  }
  const now = Date.now();
  const { buildWaTemplateBodyComponent } = await import("@/lib/waSend");
  const { broadcastTemplateToMobiles } = await import("@/lib/waBroadcast.server");
  const { publicOrigin } = await import("@/lib/birthday.server");

  for (const row of data as HeldRow[]) {
    out.checked += 1;
    // A send that died midway: some families may have it, so it is never
    // re-sent blindly — marked failed, and the sender is told.
    if (row.status === "sending") {
      if (now - Date.parse(row.updated_at) > 15 * 60_000) {
        await sb.from("wa_held_sends").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "sending");
        await tellStaff(row.requested_by_mobile, `⚠️ "${row.label}" was being sent when the server stopped. Some families may not have it — please check with the office.`, `stuck:${row.id}`);
        out.stuck += 1;
      }
      continue;
    }
    // One server at a time: only the one that flips held → sending goes on.
    const claim = await sb
      .from("wa_held_sends")
      .update({ status: "sending", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "held")
      .select("id");
    if (claim.error || !(claim.data ?? []).length) continue;

    if (Date.parse(row.expires_at) <= now) {
      await sb.from("wa_held_sends").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", row.id);
      await tellStaff(row.requested_by_mobile, composeExpiredNote({ label: row.label, notSent: countRecipients(row.recipients) }), `expired:${row.id}`);
      out.expired += 1;
      continue;
    }

    const { send, keep } = splitReleasable(row.recipients, approvedLanguages(state, row.family_key));
    let sent = 0;
    let failed = 0;
    let optedOut = 0;
    for (const [lang, mobiles] of Object.entries(send)) {
      const tpl = approvedTemplate(state, row.family_key, lang);
      if (!tpl) {
        keep[lang] = mobiles;
        continue;
      }
      const buttons = templateButtonComponents(tpl, row.vars || {});
      if (buttons.missing.length) {
        failed += mobiles.length;
        continue;
      }
      try {
        const r = await broadcastTemplateToMobiles({
          mobiles,
          template: {
            name: tpl.metaName,
            language: tpl.metaLanguage || tpl.language,
            components: [buildWaTemplateBodyComponent(tpl.variables, row.vars || {}), ...buttons.components],
          },
          module: row.module || "notices",
          originUrl: publicOrigin(),
        });
        sent += r.sent;
        failed += r.failed;
        optedOut += r.skippedOptOut;
      } catch (e) {
        console.error("[wa-autopilot] held send failed", row.id, e);
        failed += mobiles.length;
      }
    }
    const remaining = countRecipients(keep);
    const result = {
      sent: (row.result?.sent ?? 0) + sent,
      failed: (row.result?.failed ?? 0) + failed,
      optedOut: (row.result?.optedOut ?? 0) + optedOut,
    };
    await sb
      .from("wa_held_sends")
      .update({
        status: remaining ? "held" : "sent",
        recipients: keep,
        result,
        released_at: sent || failed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (sent || failed) {
      await tellStaff(
        row.requested_by_mobile,
        composeReleasedNote({ label: row.label, sent, failed, stillHeld: remaining }),
        `released:${row.id}:${remaining}`,
      );
    }
    out.sent += sent;
    out.failed += failed;
  }
  return out;
}

/* ── 3. Repair ────────────────────────────────────────────────────────── */

type RepairRow = {
  family_key: string;
  language: string;
  attempts: number;
  last_attempt_at: string | null;
  notified_at: string | null;
};

export type RepairSummary = { submitted: number; fixed: number; notified: number; reset: number; errors: string[] };

/** New templates sent to Meta per run, and rewrites per run — no bursts. */
const SUBMITS_PER_RUN = 4;
const FIXES_PER_RUN = 3;

export async function repairTemplates(start: WaTemplatesState): Promise<{ state: WaTemplatesState; summary: RepairSummary }> {
  const summary: RepairSummary = { submitted: 0, fixed: 0, notified: 0, reset: 0, errors: [] };
  let state = start;
  const ctx = await getServerTenantContext();
  if (!ctx) return { state, summary };
  const { sb, tenantId } = ctx;
  const { data: rows } = await sb
    .from("wa_template_repairs")
    .select("family_key, language, attempts, last_attempt_at, notified_at")
    .eq("tenant_id", tenantId);
  const repairs = new Map<string, RepairRow>();
  for (const r of (rows ?? []) as RepairRow[]) repairs.set(`${r.family_key}|${r.language}`, r);
  const upsert = (t: WaTemplate, patch: Record<string, unknown>) =>
    sb.from("wa_template_repairs").upsert(
      { tenant_id: tenantId, family_key: t.familyKey, language: t.language, updated_at: new Date().toISOString(), ...patch },
      { onConflict: "tenant_id,family_key,language" },
    );

  const seedFamilies = new Set(seedWaTemplates().map((t) => t.familyKey));
  const { submitWaTemplateToMeta, updateWaTemplateOnMeta, waTemplatesMetaConfigured } = await import(
    "@/lib/waTemplatesMeta.server"
  );
  if (!waTemplatesMetaConfigured()) return { state, summary };
  let changed = false;
  let submits = 0;
  let fixes = 0;
  let directors: string[] | null = null;

  for (const t of [...state.templates]) {
    const rep = repairs.get(`${t.familyKey}|${t.language}`) ?? null;
    // Approved again: the next rejection starts with a clean slate.
    if (t.status === "approved" && rep && (rep.attempts > 0 || rep.notified_at)) {
      await upsert(t, { attempts: 0, notified_at: null, last_error: "" });
      summary.reset += 1;
      continue;
    }
    const repairState: RepairState | null = rep
      ? { attempts: rep.attempts, notifiedAt: rep.notified_at || "", lastAttemptAt: rep.last_attempt_at || "" }
      : null;
    const action = templateAction(t, repairState, seedFamilies);

    if (action === "submit" && submits < SUBMITS_PER_RUN) {
      submits += 1;
      const r = await submitWaTemplateToMeta(t);
      if (r.ok && r.metaTemplateId) {
        state = markTemplateSubmittedToMeta(state, t.id, r.metaTemplateId, "autopilot");
        changed = true;
        summary.submitted += 1;
      } else {
        // Counted like a failed rewrite, so a template Meta will not take
        // reaches a person after two tries instead of being retried forever.
        await upsert(t, { attempts: (rep?.attempts ?? 0) + 1, last_attempt_at: new Date().toISOString(), last_error: r.error || "submit failed" });
        summary.errors.push(`${t.metaName}/${t.language}: ${r.error || "submit failed"}`);
      }
      continue;
    }

    if (action === "fix" && fixes < FIXES_PER_RUN) {
      fixes += 1;
      const attempts = (rep?.attempts ?? 0) + 1;
      const { generateWaTemplateRepairJson } = await import("@/lib/aiLlm.server");
      const vars = templateVariables(t.body);
      let body = "";
      let feedback = "";
      for (let i = 0; i < 2 && !body; i += 1) {
        const ai = await generateWaTemplateRepairJson({
          body: t.body,
          language: t.language === "hi" ? "hi" : "en",
          category: t.category,
          reason: t.rejectionReason,
          variables: vars,
          feedback,
        });
        if (!ai.ok) {
          feedback = "";
          summary.errors.push(`${t.metaName}/${t.language}: ${ai.error}`);
          break;
        }
        const check = validateTemplateRewrite({ body: t.body }, ai.body);
        if (check.ok) body = ai.body.trim();
        else feedback = check.errors.join("; ");
      }
      if (!body) {
        await upsert(t, { attempts, last_attempt_at: new Date().toISOString(), last_reason: t.rejectionReason, last_error: feedback || "no usable rewrite" });
        continue;
      }
      const next: WaTemplate = { ...t, body };
      const r = t.metaTemplateId ? await updateWaTemplateOnMeta(next) : await submitWaTemplateToMeta(next);
      if (!r.ok) {
        await upsert(t, { attempts, last_attempt_at: new Date().toISOString(), last_reason: t.rejectionReason, last_body: body, last_error: r.error || "Meta refused" });
        summary.errors.push(`${t.metaName}/${t.language}: ${r.error || "Meta refused"}`);
        continue;
      }
      state = {
        ...state,
        templates: state.templates.map((x) => (x.id === t.id ? { ...x, body } : x)),
      };
      const newId = "metaTemplateId" in r ? (r as { metaTemplateId?: string }).metaTemplateId : undefined;
      state = t.metaTemplateId
        ? markTemplateEditedOnMeta(state, t.id, "autopilot")
        : markTemplateSubmittedToMeta(state, t.id, newId || "", "autopilot");
      changed = true;
      summary.fixed += 1;
      await upsert(t, { attempts, last_attempt_at: new Date().toISOString(), last_reason: t.rejectionReason, last_body: body, last_error: "" });
      continue;
    }

    if (action === "notify") {
      directors ??= await directorMobiles();
      const text = composeRepairGaveUpNote({
        name: t.name || t.metaName,
        language: t.language,
        reason: t.rejectionReason,
        attempts: rep?.attempts ?? 0,
        paused: t.status === "paused",
      });
      for (const m of directors) await tellStaff(m, text, `repair:${t.id}:${rep?.attempts ?? 0}`);
      await upsert(t, { notified_at: new Date().toISOString() });
      summary.notified += 1;
    }
  }

  if (changed) {
    const pushed = await pushServerBlob("wa_templates_state", state);
    if (!pushed.ok) summary.errors.push(`registry save failed: ${pushed.error}`);
  }
  return { state, summary };
}

/* ── The run ──────────────────────────────────────────────────────────── */

export type AutopilotSummary = {
  ok: boolean;
  error?: string;
  repair?: RepairSummary;
  release?: ReleaseSummary;
};

/**
 * Sync (optional), repair, then release. Safe to run from the hourly job and
 * from the webhook at the same time: a held message is claimed by exactly
 * one run, and a repair only acts on a template still marked rejected.
 */
export async function runTemplateAutopilot(opts: { sync: boolean }): Promise<AutopilotSummary> {
  try {
    if (opts.sync) {
      const { syncWaTemplatesFromMeta } = await import("@/lib/waTemplateSync.server");
      const s = await syncWaTemplatesFromMeta();
      if (!s.ok) console.warn("[wa-autopilot] sync failed", s.error);
    }
    const start = await readRegistry();
    if (!start) return { ok: false, error: "Template registry could not be read" };
    const { state, summary: repair } = await repairTemplates(start);
    const release = await releaseHeldSends(state);
    return { ok: true, repair, release };
  } catch (e) {
    console.error("[wa-autopilot] run failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "autopilot failed" };
  }
}

/** Families approved in each language right now, from the fresh registry. */
export async function approvedLanguagesFor(familyKey: string): Promise<string[] | null> {
  const state = await readRegistry();
  return state ? approvedLanguages(state, familyKey) : null;
}
