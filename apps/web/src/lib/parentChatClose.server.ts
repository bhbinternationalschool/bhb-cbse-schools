/**
 * Closing parent chats with thanks + the guide, and the one-off guide send to
 * families inside the 24-hour window. See parentBotGuide.ts for the rule.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { isInQuietHours } from "@/lib/householdPrefs";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import { parentBotIntroMessage, parentChatClosingMessage } from "@/lib/parentBotGuide";
import { istHour, shouldCloseThread } from "@/lib/parentChatClose";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { childrenOfHousehold, householdWhatsApp, loadSis, type Household } from "@/lib/sis";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";
import { appendSisBotClosing, listWaSisBotThreads } from "@/lib/waSisBotServer";
import { mobilesAwaitingDrillReply } from "@/lib/examDrill.server";

async function ridesBus(hh: Household): Promise<boolean> {
  try {
    const { householdRidesTheBus } = await import("@/lib/parentBusLocation.server");
    const kids = childrenOfHousehold(loadSis(), hh.id, currentAcademicYearCode(loadMasters()));
    return await householdRidesTheBus(kids.map((s) => ({ id: s.id, name: s.fullName })));
  } catch {
    return true;
  }
}

export type SweepResult = {
  checked: number;
  closed: { mobile: string; guardian: string; needsOffice: boolean }[];
  failed: { mobile: string; error: string }[];
  /** Threads left open because the tutor is waiting on that family's answer. */
  midAnswer?: number;
  /** The whole sweep stood down, and why. */
  skipped?: string;
};

/** Every 15 minutes in school hours: thank and guide each parent whose chat has gone quiet. */
export async function runParentChatCloseSweep(opts: { dryRun?: boolean; now?: Date } = {}): Promise<SweepResult> {
  await ensureSchoolMirrorHydrated();
  const now = opts.now ?? new Date();
  const out: SweepResult = { checked: 0, closed: [], failed: [] };
  const h = istHour(now);
  if (h < 8 || h >= 20) return out;
  const sis = loadSis();
  // The guide or a closing already sent after the parent last wrote — e.g. the
  // one-off guide of 14 Sep — closes that conversation too. Without this the
  // first sweep re-sent the whole guide to families who had it 20 minutes ago.
  const lastGuideAt = new Map<string, string>();
  const ctx = await getServerTenantContext();
  if (ctx) {
    const { data } = await ctx.sb
      .from("household_message_log")
      .select("household_id, created_at")
      .eq("tenant_id", ctx.tenantId)
      .in("purpose", ["parent_bot_guide", "parent_chat_close"])
      .eq("status", "sent")
      .gte("created_at", new Date(now.getTime() - 26 * 3_600_000).toISOString());
    for (const r of data ?? []) {
      const k = String(r.household_id);
      const at = String(r.created_at);
      if (!lastGuideAt.has(k) || at > lastGuideAt.get(k)!) lastGuideAt.set(k, at);
    }
  } else {
    return out;
  }
  // Silence is not always the end of a conversation: it is also a child
  // fetching their book. A thread the tutor is waiting on stays open.
  const awaitingAnswer = await mobilesAwaitingDrillReply(now);
  if (!awaitingAnswer) {
    // Unreadable is not empty. Sending now could thank a family in the
    // middle of the practice the school asked them to do.
    out.skipped = "open drills unreadable — nothing closed";
    return out;
  }
  out.midAnswer = 0;

  for (const t of await listWaSisBotThreads()) {
    out.checked += 1;
    const guided = lastGuideAt.get(t.householdId);
    const d = shouldCloseThread(
      guided && (!t.closingSentAt || guided > t.closingSentAt) ? { ...t, closingSentAt: new Date(guided).toISOString() } : t,
      now,
      { awaitingAnswer: awaitingAnswer.has(waNormalizeLocal10(t.mobile)) },
    );
    if (!d.close) {
      if (d.reason === "mid_answer") out.midAnswer += 1;
      continue;
    }
    const hh = sis.households.find((x) => x.id === t.householdId);
    if (hh && isInQuietHours(hh, now)) continue;
    const text = parentChatClosingMessage({ needsOffice: d.needsOffice, hasTransport: hh ? await ridesBus(hh) : true });
    if (opts.dryRun) {
      out.closed.push({ mobile: t.mobile, guardian: t.parentName, needsOffice: d.needsOffice });
      continue;
    }
    const send = await sendWhatsAppText({ toMobile: t.mobile, body: text });
    await logHouseholdWaSend({
      mobile: t.mobile,
      purpose: "parent_chat_close",
      via: "text",
      preview: text.slice(0, 200),
      status: send.ok ? "sent" : "failed",
      error: send.ok ? undefined : send.error,
      waMessageId: send.ok ? send.providerId : undefined,
    }).catch(() => undefined);
    if (!send.ok) {
      out.failed.push({ mobile: t.mobile, error: send.error || "send failed" });
      continue;
    }
    await appendSisBotClosing({ threadId: t.id, text, at: new Date().toISOString() });
    out.closed.push({ mobile: t.mobile, guardian: t.parentName, needsOffice: d.needsOffice });
  }
  return out;
}

export type GuideSendResult = {
  targets: { householdId: string; guardian: string; mobileMasked: string }[];
  sent: number;
  failed: { householdId: string; error: string }[];
  skipped: { householdId: string; reason: string }[];
};

function mask(m: string): string {
  const d = (m || "").replace(/\D/g, "");
  return d.length >= 4 ? `••••${d.slice(-4)}` : "••••";
}

/**
 * The guide, once, to every enrolled family who has written to the school in
 * the last 23 hours — free text reaches only them. A family that already got
 * the guide or a closing message today is not sent it again.
 */
export async function sendParentGuideToOpenWindow(opts: { confirm: boolean; now?: Date }): Promise<GuideSendResult> {
  await ensureSchoolMirrorHydrated();
  const now = opts.now ?? new Date();
  const res: GuideSendResult = { targets: [], sent: 0, failed: [], skipped: [] };
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Server tenant context unavailable");
  const since = new Date(now.getTime() - 23 * 3_600_000).toISOString();
  const { data: open, error } = await ctx.sb
    .from("wa_contact_state")
    .select("mobile_e164, last_inbound_at, opted_out_at")
    .eq("tenant_id", ctx.tenantId)
    .gte("last_inbound_at", since);
  if (error) throw new Error(error.message);
  const openMobiles = new Set(
    (open ?? []).filter((r) => !r.opted_out_at).map((r) => waNormalizeLocal10(String(r.mobile_e164))),
  );

  const { data: recent, error: logErr } = await ctx.sb
    .from("household_message_log")
    .select("household_id, purpose")
    .eq("tenant_id", ctx.tenantId)
    .in("purpose", ["parent_bot_guide", "parent_chat_close"])
    .eq("status", "sent")
    .gte("created_at", new Date(now.getTime() - 20 * 3_600_000).toISOString());
  if (logErr) throw new Error(logErr.message);
  const alreadyGuided = new Set((recent ?? []).map((r) => String(r.household_id)));

  const sis = loadSis();
  const ay = currentAcademicYearCode(loadMasters());
  const seen = new Set<string>();
  for (const hh of sis.households) {
    if (seen.has(hh.id)) continue;
    if (childrenOfHousehold(sis, hh.id, ay).length === 0) continue;
    const numbers = [householdWhatsApp(hh), hh.mobile, hh.altMobile].map((m) => waNormalizeLocal10(m || "")).filter((m) => m.length === 10);
    const mobile = numbers.find((m) => openMobiles.has(m));
    if (!mobile) continue;
    seen.add(hh.id);
    if (alreadyGuided.has(hh.id)) {
      res.skipped.push({ householdId: hh.id, reason: "already sent the guide in the last 20 hours" });
      continue;
    }
    if (isInQuietHours(hh, now)) {
      res.skipped.push({ householdId: hh.id, reason: "family's quiet hours" });
      continue;
    }
    res.targets.push({ householdId: hh.id, guardian: hh.guardianName || "", mobileMasked: mask(mobile) });
    if (!opts.confirm) continue;
    const text = parentBotIntroMessage({ guardianName: hh.guardianName, hasTransport: await ridesBus(hh) });
    const send = await sendWhatsAppText({ toMobile: mobile, body: text, clientMessageId: `guide_${hh.id}_${now.toISOString().slice(0, 10)}` });
    await logHouseholdWaSend({
      mobile,
      purpose: "parent_bot_guide",
      via: "text",
      preview: text.slice(0, 200),
      status: send.ok ? "sent" : "failed",
      error: send.ok ? undefined : send.error,
      waMessageId: send.ok ? send.providerId : undefined,
    }).catch(() => undefined);
    if (send.ok) {
      res.sent += 1;
    } else {
      res.failed.push({ householdId: hh.id, error: send.error || "send failed" });
    }
  }
  return res;
}
