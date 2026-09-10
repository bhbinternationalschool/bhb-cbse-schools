/**
 * Parent numbers that cannot receive WhatsApp, and how we know.
 *
 * Grouped by NUMBER, not by message. The sent-messages tab answers "what
 * happened to this message"; the office's actual question is "which
 * families are we failing to reach, and what do I do about each one" —
 * which is one row per family, with a verdict and a next step.
 *
 * Every failure is classified through `classifyWaFailure`, so a number only
 * appears here when the failure blames the NUMBER. A family whose messages
 * failed on the 24-hour window is reachable and is deliberately left out:
 * putting them on a fix-the-numbers list sends the office correcting a
 * number that was always correct.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  classifyWaFailure,
  type WaFailureKind,
} from "@/lib/waFailureReason";
import { toE164India } from "@/lib/waContactState.server";
import { loadSis, householdWhatsApp, type Household } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { householdMobile10 } from "@/lib/parentHousehold.server";

export type WaBadNumberRow = {
  mobile: string;
  /** Bare 10 digits, for a "fix this" link into Students → Family. */
  mobile10: string;
  /** The first household, for a deep link. Null when nothing matches. */
  householdId: string | null;
  /** Every guardian on this number — a placeholder number has many. */
  guardianNames: string[];
  /**
   * How many households share this number. More than one means the number
   * is a placeholder somebody typed repeatedly, not one family's mistake.
   */
  familyCount: number;
  /** Whose parents these are — the office recognises children, not numbers. */
  children: string[];
  kind: WaFailureKind;
  label: string;
  advice: string;
  failures: number;
  lastFailedAt: string;
  /** Meta's own words, kept so nothing is lost in translation. */
  rawReason: string;
  /**
   * From wa_contact_state: false = established not on WhatsApp, true =
   * established on it, null = nobody has checked. Never rendered as a
   * guess either way.
   */
  onWhatsApp: boolean | null;
  checkedAt: string | null;
  checkSource: string | null;
};

export type WaNumberHealth = {
  rows: WaBadNumberRow[];
  /** Numbers whose failures were NOT the number's fault, for honesty. */
  reachableButFailing: number;
  ok: boolean;
  error?: string;
};

const WINDOW_DAYS = 90;

/**
 * EVERY household on this number, not the first one.
 *
 * A placeholder like 0000000000 gets typed into the roster once per family
 * that arrived without a phone: this school has eight households sharing
 * that one number, four of them with children currently enrolled. Taking
 * `find` would have named one guardian and silently hidden the other seven
 * — so the office fixes one family and believes the number is done.
 */
function householdsFor(
  households: Household[],
  mobile10: string,
): Household[] {
  return households.filter(
    (h) =>
      householdMobile10(householdWhatsApp(h)) === mobile10 ||
      householdMobile10(h.mobile) === mobile10 ||
      householdMobile10(h.altMobile) === mobile10,
  );
}

/**
 * The numbers to fix.
 *
 * Reads both signals and merges them: a number Meta's /contacts lookup has
 * already marked `on_whatsapp = false` appears even with no failed send
 * behind it, because the roster check found it before a send ever went out.
 */
export async function listWaBadNumbers(opts?: {
  sinceIso?: string;
}): Promise<WaNumberHealth> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { rows: [], reachableButFailing: 0, ok: false, error: "Tenant not configured" };
  }
  const { sb, tenantId } = ctx;
  const sinceIso =
    opts?.sinceIso ||
    new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  // 1. Observed failures, from both logs. The delivery log carries Meta's
  //    verdict after handoff; the message log carries the sends we never
  //    managed to hand over at all.
  const [deliveryRes, logRes, stateRes] = await Promise.all([
    sb
      .from("wa_message_delivery")
      .select("mobile_e164, status, error_message, event_at")
      .eq("tenant_id", tenantId)
      .eq("status", "failed")
      .gte("event_at", sinceIso),
    sb
      .from("household_message_log")
      .select("mobile_e164, status, error, created_at")
      .eq("tenant_id", tenantId)
      .eq("channel", "wa")
      .eq("direction", "out")
      .eq("status", "failed")
      .gte("created_at", sinceIso),
    sb
      .from("wa_contact_state")
      .select("mobile_e164, on_whatsapp, wa_checked_at, wa_check_source")
      .eq("tenant_id", tenantId)
      .not("on_whatsapp", "is", null),
  ]);

  if (deliveryRes.error || logRes.error) {
    // A failed read is not a clean bill of health.
    return {
      rows: [],
      reachableButFailing: 0,
      ok: false,
      error: deliveryRes.error?.message || logRes.error?.message,
    };
  }

  type Acc = {
    mobile: string;
    kind: WaFailureKind;
    label: string;
    advice: string;
    failures: number;
    lastFailedAt: string;
    rawReason: string;
  };
  const byNumber = new Map<string, Acc>();
  let reachableButFailing = 0;
  const reachableSeen = new Set<string>();

  const note = (mobileRaw: string, reason: string, at: string) => {
    const mobile10 = householdMobile10(mobileRaw);
    if (!mobile10) return;
    const verdict = classifyWaFailure(reason);
    if (!verdict.numberAtFault) {
      // Counted, not listed — so the tab can say "12 more failures that are
      // not the number's fault" instead of quietly hiding them.
      if (!reachableSeen.has(mobile10)) {
        reachableSeen.add(mobile10);
        reachableButFailing++;
      }
      return;
    }
    const cur = byNumber.get(mobile10);
    if (!cur) {
      byNumber.set(mobile10, {
        mobile: mobile10,
        kind: verdict.kind,
        label: verdict.label,
        advice: verdict.advice,
        failures: 1,
        lastFailedAt: at,
        rawReason: reason,
      });
      return;
    }
    cur.failures++;
    if (at > cur.lastFailedAt) {
      cur.lastFailedAt = at;
      // Keep the MOST RECENT verdict: a number corrected and then failing
      // for a different reason should read as the new reason.
      cur.kind = verdict.kind;
      cur.label = verdict.label;
      cur.advice = verdict.advice;
      cur.rawReason = reason;
    }
  };

  for (const r of deliveryRes.data || []) {
    note(
      String(r.mobile_e164 || ""),
      String(r.error_message || ""),
      String(r.event_at || ""),
    );
  }
  for (const r of logRes.data || []) {
    note(
      String(r.mobile_e164 || ""),
      String(r.error || ""),
      String(r.created_at || ""),
    );
  }

  // 2. The stored verdicts — including numbers the roster check condemned
  //    before any send was attempted.
  const stateByMobile = new Map<
    string,
    { onWhatsApp: boolean | null; checkedAt: string | null; source: string | null }
  >();
  for (const r of stateRes.data || []) {
    const m10 = householdMobile10(String(r.mobile_e164 || ""));
    if (!m10) continue;
    stateByMobile.set(m10, {
      onWhatsApp: r.on_whatsapp === null ? null : !!r.on_whatsapp,
      checkedAt: r.wa_checked_at ? String(r.wa_checked_at) : null,
      source: r.wa_check_source ? String(r.wa_check_source) : null,
    });
    if (r.on_whatsapp === false && !byNumber.has(m10)) {
      byNumber.set(m10, {
        mobile: m10,
        kind: "not_on_whatsapp",
        label: "Not on WhatsApp",
        advice: classifyWaFailure("Message undeliverable").advice,
        failures: 0,
        lastFailedAt: r.wa_checked_at ? String(r.wa_checked_at) : "",
        rawReason: "Meta's contacts check says this number has no WhatsApp account",
      });
    }
  }

  // 3. Put a family's name to each number. Without this the office is
  //    handed ten phone numbers and no idea whose they are.
  await ensureSisHydratedServer().catch(() => false);
  const sis = loadSis();
  const households = sis.households ?? [];
  const students = sis.students ?? [];

  const rows: WaBadNumberRow[] = [...byNumber.values()].map((a) => {
    const hhs = householdsFor(households, a.mobile);
    const hhIds = new Set(hhs.map((h) => h.id));
    const state = stateByMobile.get(a.mobile);
    return {
      mobile: `91${a.mobile}`,
      mobile10: a.mobile,
      householdId: hhs[0]?.id ?? null,
      guardianNames: hhs.map((h) => h.guardianName).filter(Boolean),
      familyCount: hhs.length,
      children: students
        .filter((s) => hhIds.has(s.householdId) && s.status === "active")
        .map((s) => s.fullName),
      kind: a.kind,
      label: a.label,
      advice: a.advice,
      failures: a.failures,
      lastFailedAt: a.lastFailedAt,
      rawReason: a.rawReason,
      onWhatsApp: state?.onWhatsApp ?? null,
      checkedAt: state?.checkedAt ?? null,
      checkSource: state?.source ?? null,
    };
  });

  // Most enrolled children affected first. Failure count was the wrong
  // order: a placeholder number shared by four families with eleven children
  // between them may have fewer failed sends than one chatty test number.
  rows.sort(
    (x, y) =>
      y.children.length - x.children.length ||
      y.failures - x.failures ||
      y.lastFailedAt.localeCompare(x.lastFailedAt),
  );

  return { rows, reachableButFailing, ok: true };
}

/**
 * Record what we now know about a number.
 *
 * Upserted onto `wa_contact_state`, the row that already answers the other
 * per-number question (STOP), so a sender has one place to ask.
 */
export async function recordWaNumberVerdicts(
  verdicts: { mobile: string; onWhatsApp: boolean }[],
  source: "contacts_api" | "send_failure",
): Promise<{ ok: boolean; written: number; error?: string }> {
  if (!verdicts.length) return { ok: true, written: 0 };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, written: 0, error: "Tenant not configured" };
  const now = new Date().toISOString();
  const rows = verdicts
    .map((v) => ({
      tenant_id: ctx.tenantId,
      mobile_e164: toE164India(v.mobile),
      on_whatsapp: v.onWhatsApp,
      wa_checked_at: now,
      wa_check_source: source,
      updated_at: now,
    }))
    .filter((r) => r.mobile_e164.length >= 12);
  if (!rows.length) return { ok: true, written: 0 };

  const { error } = await ctx.sb
    .from("wa_contact_state")
    .upsert(rows, { onConflict: "tenant_id,mobile_e164" });
  if (error) return { ok: false, written: 0, error: error.message };
  return { ok: true, written: rows.length };
}

/**
 * Numbers already established as NOT on WhatsApp, out of the ones asked about.
 *
 * So a fee run does not spend a send — and a failure row, and a line on the
 * office's list — on a number Meta has already said twice is not a WhatsApp
 * user. Returns E.164 keys, matching `listOptedOutSet`, because the callers
 * apply both filters together.
 *
 * Fails OPEN: if this lookup breaks, everyone is sent to. A read error must
 * not silently shrink a fee reminder's audience.
 */
export async function listKnownNotOnWhatsApp(
  mobiles: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const e164s = [...new Set(mobiles.map(toE164India).filter(Boolean))];
  if (!e164s.length) return out;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return out;
    const CHUNK = 200;
    for (let i = 0; i < e164s.length; i += CHUNK) {
      const { data, error } = await ctx.sb
        .from("wa_contact_state")
        .select("mobile_e164, on_whatsapp")
        .eq("tenant_id", ctx.tenantId)
        .eq("on_whatsapp", false)
        .in("mobile_e164", e164s.slice(i, i + CHUNK));
      if (error) {
        console.warn("[waNumberHealth] not-on-whatsapp read failed", error.message);
        continue;
      }
      for (const r of data || []) out.add(String(r.mobile_e164 || ""));
    }
  } catch (e) {
    console.warn("[waNumberHealth] listKnownNotOnWhatsApp threw", e);
  }
  return out;
}
