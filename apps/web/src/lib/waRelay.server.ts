import "server-only";

/**
 * The office relay, on the server: record, forward, route replies back.
 *
 * See waRelay.ts for what the relay is and why it exists. This file does the
 * I/O, and every failure it can reach is RECORDED rather than swallowed — the
 * whole reason the relay exists is that "the bot gave up and nobody knew" was
 * the normal state of affairs.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchServerBlob } from "@/lib/serverBlob";
import { childrenOfHousehold, loadSis } from "@/lib/sis";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { classLabelForStudent } from "@/lib/parentPortal";
import { resolveWaIdentityServer } from "@/lib/waRoleResolver.server";
import { detectSisFeeReplyIntent } from "@/lib/sisParentBotEngine";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import { fetchWaMediaAsDataUrl } from "@/lib/waInboundMedia.server";
import {
  sendWhatsAppDocument,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  waNormalizeLocal10,
} from "@/lib/waSend";
import {
  normalizeWaTemplatesState,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import {
  formatRelayForward,
  isRelayOfficeNumber,
  makeRelayCode,
  normalizeRelayRoute,
  parseRelayReplyCode,
  relayCategoryFor,
  relayCategoryLabel,
  relayReasonFor,
  routesFor,
  templateSafe,
  type RelayCategory,
  type RelayRoute,
} from "@/lib/waRelay";

/**
 * The approved UTILITY template that carries a forward when the office
 * phone's own 24-hour window is closed. Positional body parameters:
 *   {{1}} category label   {{2}} sender "Name (mobile)"
 *   {{3}} code             {{4}} the message
 * Looked up by Meta name, not by a seed family: a Meta sync adds any approved
 * template to the registry by name, which is all this needs.
 */
export const OFFICE_RELAY_TEMPLATE = "bhb_office_relay";

/* ── routes ───────────────────────────────────────────────────── */

export async function loadRelayRoutes(): Promise<
  { ok: true; routes: RelayRoute[] } | { ok: false; error: string }
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Server tenant context unavailable" };
  const { data, error } = await ctx.sb
    .from("wa_relay_routes")
    .select("id, name, mobile10, categories, active")
    .eq("tenant_id", ctx.tenantId)
    .order("name", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    routes: (data ?? [])
      .map((r) => normalizeRelayRoute(r))
      .filter((r): r is RelayRoute => !!r),
  };
}

/**
 * Replace the route list with what the office saved.
 *
 * The screen sends the whole list, so a row that is missing was removed on
 * purpose. That is the one delete the relay does, and it only ever touches
 * routes — never a recorded message.
 */
export async function saveRelayRoutes(
  input: unknown[],
  by: string,
): Promise<{ ok: true; routes: RelayRoute[] } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Server tenant context unavailable" };
  const routes = input
    .map((r) => normalizeRelayRoute(r))
    .filter((r): r is RelayRoute => !!r);

  const now = new Date().toISOString();
  if (routes.length > 0) {
    const { error } = await ctx.sb.from("wa_relay_routes").upsert(
      routes.map((r) => ({
        id: r.id,
        tenant_id: ctx.tenantId,
        name: r.name,
        mobile10: r.mobile10,
        categories: r.categories,
        active: r.active,
        updated_at: now,
        updated_by: by,
      })),
      { onConflict: "id" },
    );
    if (error) return { ok: false, error: error.message };
  }

  const keep = routes.map((r) => r.id);
  let del = ctx.sb.from("wa_relay_routes").delete().eq("tenant_id", ctx.tenantId);
  if (keep.length > 0) del = del.not("id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  const { error: delErr } = await del;
  if (delErr) return { ok: false, error: delErr.message };

  return loadRelayRoutes();
}

/* ── forwarding an escalation ─────────────────────────────────── */

export type RelayEscalationInput = {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  /** The unified bot's flow name, e.g. "sis_parent", "voice_note_handoff". */
  audience: string;
  /** Force a category (the complaint form knows exactly what it is). */
  category?: RelayCategory;
  mediaNote?: string | null;
  media?: { mediaId: string; mimeType?: string; filename?: string } | null;
  reason?: string;
};

async function uniqueCode(
  sb: NonNullable<Awaited<ReturnType<typeof getServerTenantContext>>>["sb"],
  tenantId: string,
): Promise<string> {
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  for (let i = 0; i < 8; i += 1) {
    const code = makeRelayCode();
    const { data } = await sb
      .from("wa_relay_messages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("code", code)
      .gte("created_at", since)
      .limit(1);
    if (!data || data.length === 0) return code;
  }
  // 31^4 codes and a handful a day: eight collisions in a row does not happen,
  // but if it does a fifth character keeps the code unique.
  return makeRelayCode() + makeRelayCode().slice(0, 1);
}

function senderContextFor(identityRoles: { kind: string; householdId?: string; label: string }[]): {
  householdId: string | null;
  context: string;
} {
  const parentRole = identityRoles.find((r) => r.kind === "parent" && r.householdId);
  if (parentRole?.householdId) {
    const sis = loadSis();
    const masters = loadMasters();
    // Each child once, this session — see childrenOfHousehold.
    const labels = childrenOfHousehold(
      sis,
      parentRole.householdId,
      currentAcademicYearCode(masters),
    ).map((s) => {
      const cls = classLabelForStudent(s, masters);
      return `${s.fullName}${cls ? ` · ${cls}` : ""}`;
    });
    return { householdId: parentRole.householdId, context: labels.slice(0, 3).join(" / ") };
  }
  const staffRole = identityRoles.find((r) => r.kind === "staff" || r.kind === "teacher" || r.kind === "owner");
  return { householdId: null, context: staffRole ? staffRole.label : "" };
}

async function approvedRelayTemplate(): Promise<{ name: string; language: string } | null> {
  try {
    const { state } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
    const reg = normalizeWaTemplatesState(state);
    const approved = reg.templates.filter(
      (x) => x.metaName === OFFICE_RELAY_TEMPLATE && x.status === "approved" && !x.paused,
    );
    // The office reads English labels in the panel; prefer that copy when both are approved.
    const t = approved.find((x) => x.language === "en") ?? approved[0];
    return t ? { name: t.metaName, language: t.metaLanguage || t.language } : null;
  } catch {
    return null;
  }
}

/**
 * Record a message the bot could not answer and forward it by category.
 *
 * Never throws: it is called from the webhook after the parent has already
 * been answered, and a failure here must be recorded, not lost in a log.
 */
export async function relayEscalation(input: RelayEscalationInput): Promise<{
  ok: boolean;
  relayId?: string;
  code?: string;
  forwarded: number;
  status: string;
  error?: string;
}> {
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return { ok: false, forwarded: 0, status: "failed", error: "no tenant" };

    const sender10 = waNormalizeLocal10(input.fromWaId);
    const routesRes = await loadRelayRoutes();
    const routes = routesRes.ok ? routesRes.routes : [];

    // An office phone escalating its own message would forward to itself.
    if (isRelayOfficeNumber(sender10, routes)) {
      return { ok: true, forwarded: 0, status: "office_sender_skipped" };
    }

    const identity = await resolveWaIdentityServer(input.fromWaId);
    const roleKinds = identity.roles.map((r) => r.kind);
    const category =
      input.category ??
      relayCategoryFor({
        audience: input.audience,
        roleKinds,
        feeReply: !!detectSisFeeReplyIntent(input.text || ""),
      });
    const { householdId, context } = senderContextFor(identity.roles);
    const senderName = identity.displayName || input.profileName || "";
    const reason = input.reason || relayReasonFor(input.audience, !!input.media);
    const code = await uniqueCode(ctx.sb, ctx.tenantId);

    const { data: inserted, error: insErr } = await ctx.sb
      .from("wa_relay_messages")
      .insert({
        tenant_id: ctx.tenantId,
        code,
        category,
        reason,
        sender_mobile10: sender10,
        sender_name: senderName,
        sender_context: context,
        household_id: householdId,
        inbound_wa_message_id: input.waMessageId || null,
        inbound_text: (input.text || "").slice(0, 4000),
        media_note: input.mediaNote || "",
        media_id: input.media?.mediaId || null,
        media_mime: input.media?.mimeType || null,
        status: "forwarded",
      })
      .select("id")
      .single();

    if (insErr) {
      // A retried webhook for a message already relayed: not an error.
      if (/duplicate key|unique/i.test(insErr.message)) {
        return { ok: true, forwarded: 0, status: "duplicate" };
      }
      console.error("[wa-relay] could not record escalation", insErr.message);
      return { ok: false, forwarded: 0, status: "failed", error: insErr.message };
    }
    const relayId = inserted.id as string;

    const targets = routesFor(category, routes);
    if (targets.length === 0) {
      await ctx.sb.from("wa_relay_messages").update({ status: "no_route" }).eq("id", relayId);
      return { ok: true, relayId, code, forwarded: 0, status: "no_route" };
    }

    const facts = {
      code,
      category,
      senderName,
      senderMobile10: sender10,
      context,
      text: input.text || "",
      mediaNote: input.mediaNote ? `📎 ${input.mediaNote}` : "",
      reason,
    };
    let template: { name: string; language: string } | null | undefined;
    let forwarded = 0;

    for (const route of targets) {
      let via: "text" | "template" | "none" = "text";
      let res = await sendWhatsAppText({
        toMobile: route.mobile10,
        body: formatRelayForward(facts),
        clientMessageId: `relay:${relayId}:${route.mobile10}`,
      });

      // The office phone has not written to the school in 24 hours: only an
      // approved template may reach it.
      if (!res.ok && /24h|session window/i.test(res.error || "")) {
        if (template === undefined) template = await approvedRelayTemplate();
        if (template) {
          via = "template";
          res = await sendWhatsAppTemplate({
            toMobile: route.mobile10,
            name: template.name,
            language: template.language,
            components: [
              {
                type: "body",
                parameters: [
                  relayCategoryLabel(category),
                  `${senderName || "Unknown"} (${sender10})`,
                  code,
                  `${input.text || input.mediaNote || "(no text)"}${context ? ` — re ${context}` : ""}`,
                ].map((t) => ({ type: "text" as const, text: templateSafe(t) })),
              },
            ],
            clientMessageId: `relay:${relayId}:${route.mobile10}:tpl`,
          });
        } else {
          via = "none";
          res = {
            ...res,
            error:
              `${res.error} — and the "${OFFICE_RELAY_TEMPLATE}" template is not approved yet, ` +
              "so this phone can only receive forwards after it has messaged the school number today.",
          };
        }
      }

      await ctx.sb.from("wa_relay_forwards").insert({
        tenant_id: ctx.tenantId,
        relay_id: relayId,
        route_id: route.id,
        office_name: route.name,
        office_mobile10: route.mobile10,
        forward_wa_message_id: res.ok ? res.providerId || null : null,
        via,
        status: res.ok ? "sent" : "failed",
        error: res.ok ? "" : (res.error || "send failed").slice(0, 500),
      });

      if (res.ok) {
        forwarded += 1;
        // The photo / voice note / document itself, as a file, while the
        // window is open. Best-effort: the text forward already says what came.
        if (input.media?.mediaId && via === "text") {
          try {
            const got = await fetchWaMediaAsDataUrl(input.media.mediaId);
            if (got.ok) {
              const b64 = got.dataUrl.split(",")[1] || "";
              const ext = (got.mimeType.split("/")[1] || "bin").split(";")[0];
              await sendWhatsAppDocument({
                toMobile: route.mobile10,
                bytes: Buffer.from(b64, "base64"),
                filename: input.media.filename || `from-${sender10}.${ext}`,
                mimeType: got.mimeType,
                caption: `#${code} · ${senderName || sender10}`,
              });
            }
          } catch (e) {
            console.warn("[wa-relay] media forward failed", relayId, e);
          }
        }
      }
    }

    const status = forwarded > 0 ? "forwarded" : "failed";
    if (status !== "forwarded") {
      await ctx.sb.from("wa_relay_messages").update({ status }).eq("id", relayId);
    }
    return { ok: forwarded > 0, relayId, code, forwarded, status };
  } catch (e) {
    console.error("[wa-relay] relayEscalation threw", e);
    return { ok: false, forwarded: 0, status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/* ── an office reply ──────────────────────────────────────────── */

/**
 * Is this inbound message an office phone answering a forward? If so, send the
 * answer to the original sender and report `handled: true` so nothing else
 * touches it.
 *
 * Deliberately narrow. A message from an office phone that neither swipe-
 * replies to a forward nor starts with a code is NOT taken: that person is
 * also staff, and may be marking attendance or asking the ERP something.
 */
export async function handleRelayReply(msg: {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  replyToWaMessageId?: string;
  hasMedia?: boolean;
}): Promise<{ handled: boolean; delivered?: boolean; error?: string }> {
  const office10 = waNormalizeLocal10(msg.fromWaId);
  const routesRes = await loadRelayRoutes();
  if (!routesRes.ok || !isRelayOfficeNumber(office10, routesRes.routes)) {
    return { handled: false };
  }
  const ctx = await getServerTenantContext();
  if (!ctx) return { handled: false };
  const officeName =
    routesRes.routes.find((r) => r.mobile10 === office10)?.name || "Office";

  let relayId: string | null = null;
  let matchedBy: "swipe" | "code" = "swipe";
  let body = (msg.text || "").trim();

  if (msg.replyToWaMessageId) {
    const { data } = await ctx.sb
      .from("wa_relay_forwards")
      .select("relay_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("forward_wa_message_id", msg.replyToWaMessageId)
      .limit(1);
    relayId = (data?.[0]?.relay_id as string) || null;
  }
  const coded = parseRelayReplyCode(body);
  if (coded) {
    body = coded.body;
    if (!relayId) {
      matchedBy = "code";
      const { data } = await ctx.sb
        .from("wa_relay_messages")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("code", coded.code)
        .order("created_at", { ascending: false })
        .limit(1);
      relayId = (data?.[0]?.id as string) || null;
      if (!relayId) {
        await sendWhatsAppText({
          toMobile: office10,
          body: `⚠️ No message with code #${coded.code} was found. Check the code, or swipe right on the forwarded message and reply there.`,
        });
        return { handled: true, delivered: false, error: "unknown code" };
      }
    }
  }
  // A swipe-reply to something that is not a relay forward, with no code:
  // not ours.
  if (!relayId) return { handled: false };

  const { data: relay } = await ctx.sb
    .from("wa_relay_messages")
    // inbound_text and category ride along so an office reply can be kept as a
    // proposed answer-book entry (answerBook.server.ts).
    .select("id, code, category, inbound_text, sender_mobile10, sender_name, household_id")
    .eq("id", relayId)
    .single();
  if (!relay) return { handled: false };

  if (!body) {
    await sendWhatsAppText({
      toMobile: office10,
      body: msg.hasMedia
        ? `⚠️ Only a text reply can be sent on for #${relay.code} at the moment. Please type your answer.`
        : `⚠️ Your reply for #${relay.code} was empty, so nothing was sent.`,
    });
    return { handled: true, delivered: false, error: "empty reply" };
  }

  // Claim this office message first: a retried webhook must not send twice.
  const { data: claim, error: claimErr } = await ctx.sb
    .from("wa_relay_replies")
    .insert({
      tenant_id: ctx.tenantId,
      relay_id: relay.id,
      office_mobile10: office10,
      office_name: officeName,
      office_wa_message_id: msg.waMessageId || null,
      matched_by: matchedBy,
      body: body.slice(0, 4000),
      status: "sent",
    })
    .select("id")
    .single();
  if (claimErr) {
    if (/duplicate key|unique/i.test(claimErr.message)) return { handled: true };
    return { handled: true, delivered: false, error: claimErr.message };
  }

  const send = await sendWhatsAppText({
    toMobile: relay.sender_mobile10 as string,
    body,
    clientMessageId: `relay-reply:${claim.id}`,
  });

  await ctx.sb
    .from("wa_relay_replies")
    .update({
      delivered_wa_message_id: send.ok ? send.providerId || null : null,
      status: send.ok ? "sent" : "failed",
      error: send.ok ? "" : (send.error || "send failed").slice(0, 500),
    })
    .eq("id", claim.id);

  if (send.ok) {
    // The office has just answered a question the bot could not. That pair —
    // what a parent asked, what the school said — is the only teaching signal
    // this system has, and until 19 Sep 2026 it was thrown away: 15 questions
    // handed over, 0 kept. It is captured as PROPOSED; nobody is answered
    // from it until someone with the authority approves the wording.
    void (async () => {
      try {
        const { captureAnswerPair } = await import("@/lib/answerBook.server");
        await captureAnswerPair({
          question: String(relay.inbound_text || ""),
          answer: body,
          category: String(relay.category || "general"),
          source: "office_reply",
          sourceRef: `relay:${relay.code}`,
        });
      } catch (e) {
        // Learning is a bonus; the parent's answer has already gone.
        console.warn("[answerBook] could not capture the office reply", (e as Error)?.message);
      }
    })();

    await ctx.sb
      .from("wa_relay_messages")
      .update({ status: "replied", replied_at: new Date().toISOString() })
      .eq("id", relay.id);
  }

  // On the WhatsApp screen's Delivered tab with its ticks, like every send.
  await logHouseholdWaSend({
    mobile: relay.sender_mobile10 as string,
    purpose: "office_relay_reply",
    via: "text",
    preview: `${officeName}: ${body}`.slice(0, 400),
    status: send.ok ? "sent" : "failed",
    error: send.ok ? "" : send.error || "",
    waMessageId: send.ok ? send.providerId || "" : "",
  }).catch(() => undefined);

  const who = (relay.sender_name as string) || (relay.sender_mobile10 as string);
  await sendWhatsAppText({
    toMobile: office10,
    body: send.ok
      ? `✅ Sent to ${who} (#${relay.code}).`
      : /24h|session window/i.test(send.error || "")
        ? `⚠️ Not sent to ${who} (#${relay.code}): it has been more than 24 hours since they last messaged, so WhatsApp only allows an approved template. Please call them on ${relay.sender_mobile10} or reply from the ERP inbox.`
        : `⚠️ Not sent to ${who} (#${relay.code}): ${send.error || "WhatsApp refused it"}.`,
  });

  return { handled: true, delivered: send.ok, error: send.ok ? undefined : send.error };
}

/* ── the record ───────────────────────────────────────────────── */

export type RelayLogRow = {
  id: string;
  code: string;
  category: string;
  reason: string;
  senderName: string;
  senderMobile10: string;
  senderContext: string;
  text: string;
  mediaNote: string;
  status: string;
  createdAt: string;
  repliedAt: string | null;
  forwards: { officeName: string; officeMobile10: string; via: string; status: string; error: string; sentAt: string }[];
  replies: { officeName: string; body: string; matchedBy: string; status: string; error: string; at: string }[];
};

export async function listRelayLog(opts: {
  days?: number;
  category?: string;
  status?: string;
  q?: string;
  limit?: number;
}): Promise<{ ok: true; rows: RelayLogRow[] } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Server tenant context unavailable" };
  const days = Math.min(Math.max(opts.days ?? 30, 1), 3650);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  let q = ctx.sb
    .from("wa_relay_messages")
    .select("id, code, category, reason, sender_name, sender_mobile10, sender_context, inbound_text, media_note, status, created_at, replied_at")
    .eq("tenant_id", ctx.tenantId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
  if (opts.category) q = q.eq("category", opts.category);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  const ids = (data ?? []).map((r) => r.id as string);
  const forwardsBy = new Map<string, RelayLogRow["forwards"]>();
  const repliesBy = new Map<string, RelayLogRow["replies"]>();
  if (ids.length > 0) {
    const [f, r] = await Promise.all([
      ctx.sb.from("wa_relay_forwards")
        .select("relay_id, office_name, office_mobile10, via, status, error, sent_at")
        .eq("tenant_id", ctx.tenantId).in("relay_id", ids),
      ctx.sb.from("wa_relay_replies")
        .select("relay_id, office_name, body, matched_by, status, error, created_at")
        .eq("tenant_id", ctx.tenantId).in("relay_id", ids).order("created_at", { ascending: true }),
    ]);
    if (f.error) return { ok: false, error: f.error.message };
    if (r.error) return { ok: false, error: r.error.message };
    for (const x of f.data ?? []) {
      const list = forwardsBy.get(x.relay_id as string) ?? [];
      list.push({
        officeName: String(x.office_name || ""),
        officeMobile10: String(x.office_mobile10 || ""),
        via: String(x.via || ""),
        status: String(x.status || ""),
        error: String(x.error || ""),
        sentAt: String(x.sent_at || ""),
      });
      forwardsBy.set(x.relay_id as string, list);
    }
    for (const x of r.data ?? []) {
      const list = repliesBy.get(x.relay_id as string) ?? [];
      list.push({
        officeName: String(x.office_name || ""),
        body: String(x.body || ""),
        matchedBy: String(x.matched_by || ""),
        status: String(x.status || ""),
        error: String(x.error || ""),
        at: String(x.created_at || ""),
      });
      repliesBy.set(x.relay_id as string, list);
    }
  }

  const needle = (opts.q || "").trim().toLowerCase();
  const rows: RelayLogRow[] = (data ?? []).map((m) => ({
    id: m.id as string,
    code: String(m.code),
    category: String(m.category),
    reason: String(m.reason || ""),
    senderName: String(m.sender_name || ""),
    senderMobile10: String(m.sender_mobile10 || ""),
    senderContext: String(m.sender_context || ""),
    text: String(m.inbound_text || ""),
    mediaNote: String(m.media_note || ""),
    status: String(m.status),
    createdAt: String(m.created_at),
    repliedAt: (m.replied_at as string) || null,
    forwards: forwardsBy.get(m.id as string) ?? [],
    replies: repliesBy.get(m.id as string) ?? [],
  }));
  return {
    ok: true,
    rows: needle
      ? rows.filter((r) =>
          [r.code, r.senderName, r.senderMobile10, r.senderContext, r.text]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : rows,
  };
}
