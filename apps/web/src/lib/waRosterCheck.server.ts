/**
 * Ask Meta whether the school's parent numbers are on WhatsApp — before a
 * send, not during one.
 *
 * `checkWhatsAppContacts` has existed since go-live and was wired to
 * exactly one screen: the admissions leads panel. Enrolled families'
 * numbers — the ones fee reminders go to — were never checked, so the
 * school found out a number was wrong by failing to reach a parent about
 * money.
 *
 * Deliberately a manual action, not a tick: it spends a Graph API call per
 * batch of 100 against a roster that changes a few times a term. Run it
 * before a fee run, or after importing a class.
 */

import "server-only";

import { checkWhatsAppContacts, waOutboundConfigured } from "@/lib/waSend";
import { loadSis, householdWhatsApp, type Household } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { householdMobile10 } from "@/lib/parentHousehold.server";
import { recordWaNumberVerdicts } from "@/lib/waNumberHealth.server";

export type WaRosterCheckResult = {
  ok: boolean;
  /** Numbers we asked about. */
  checked: number;
  onWhatsApp: number;
  notOnWhatsApp: number;
  /** Meta answered, but not for these — left unchecked rather than guessed. */
  noAnswer: number;
  /** The bad ones, named, so the answer is usable without another screen. */
  bad: { mobile: string; guardianNames: string[]; children: string[] }[];
  mode: string;
  error?: string;
};

/** Meta's contacts endpoint takes 100 at a time; `checkWhatsAppContacts` caps there too. */
const BATCH = 100;

function activeHouseholds(): { household: Household; mobile10: string }[] {
  const sis = loadSis();
  const activeIds = new Set(
    (sis.students ?? [])
      .filter((s) => s.status === "active")
      .map((s) => s.householdId)
      .filter(Boolean),
  );
  const out: { household: Household; mobile10: string }[] = [];
  const seen = new Set<string>();
  for (const h of sis.households ?? []) {
    if (!activeIds.has(h.id)) continue;
    const mobile10 = householdMobile10(householdWhatsApp(h) || h.mobile);
    if (mobile10.length !== 10 || seen.has(mobile10)) continue;
    seen.add(mobile10);
    out.push({ household: h, mobile10 });
  }
  return out;
}

export async function checkRosterOnWhatsApp(): Promise<WaRosterCheckResult> {
  if (!waOutboundConfigured()) {
    return {
      ok: false,
      checked: 0,
      onWhatsApp: 0,
      notOnWhatsApp: 0,
      noAnswer: 0,
      bad: [],
      mode: "none",
      error:
        "No WhatsApp provider is configured, so Meta cannot be asked. Set the WhatsApp credentials first.",
    };
  }

  await ensureSisHydratedServer().catch(() => false);
  const roster = activeHouseholds();
  if (!roster.length) {
    return {
      ok: false,
      checked: 0,
      onWhatsApp: 0,
      notOnWhatsApp: 0,
      noAnswer: 0,
      bad: [],
      mode: "none",
      error:
        "No active families with a mobile number were found — the roster may not have loaded.",
    };
  }

  const sis = loadSis();
  const students = sis.students ?? [];
  const allByMobile = new Map<string, Household[]>();
  for (const h of sis.households ?? []) {
    const m10 = householdMobile10(householdWhatsApp(h) || h.mobile);
    if (m10.length !== 10) continue;
    const list = allByMobile.get(m10) ?? [];
    list.push(h);
    allByMobile.set(m10, list);
  }

  let onWhatsApp = 0;
  let notOnWhatsApp = 0;
  let answered = 0;
  const bad: WaRosterCheckResult["bad"] = [];
  const verdicts: { mobile: string; onWhatsApp: boolean }[] = [];
  let mode = "none";
  const errors: string[] = [];

  for (let i = 0; i < roster.length; i += BATCH) {
    const slice = roster.slice(i, i + BATCH).map((r) => r.mobile10);
    const res = await checkWhatsAppContacts(slice);
    if (res.mode) mode = res.mode;
    if (!res.ok) {
      if (res.error && errors.length < 3) errors.push(res.error);
      continue;
    }
    for (const r of res.results) {
      const m10 = r.local10 || householdMobile10(r.input);
      if (!m10) continue;
      // "unknown" and "invalid_format" are not answers about WhatsApp:
      // unknown means the provider did not say, and an unanswered number
      // must stay unchecked rather than be written down as bad. A badly
      // formatted number is a roster problem the bad-numbers list already
      // reports from failed sends.
      if (r.status !== "on_whatsapp" && r.status !== "not_on_whatsapp") {
        continue;
      }
      const exists = r.status === "on_whatsapp";
      answered++;
      verdicts.push({ mobile: m10, onWhatsApp: exists });
      if (exists) {
        onWhatsApp++;
        continue;
      }
      notOnWhatsApp++;
      // Every family on the number, for the same reason as the bad-numbers
      // list: a placeholder is shared, and naming one guardian hides the rest.
      const hhs = allByMobile.get(m10) ?? [];
      const hhIds = new Set(hhs.map((h) => h.id));
      bad.push({
        mobile: m10,
        guardianNames: hhs.map((h) => h.guardianName).filter(Boolean),
        children: students
          .filter((s) => hhIds.has(s.householdId) && s.status === "active")
          .map((s) => s.fullName),
      });
    }
  }

  const stored = await recordWaNumberVerdicts(verdicts, "contacts_api");
  if (!stored.ok && stored.error && errors.length < 3) {
    errors.push(`Verdicts not saved: ${stored.error}`);
  }

  return {
    // Asking and getting no usable answer is not success — the office would
    // otherwise read "0 bad numbers" as a clean roster.
    ok: answered > 0,
    checked: roster.length,
    onWhatsApp,
    notOnWhatsApp,
    noAnswer: roster.length - answered,
    bad,
    mode,
    error: errors.length
      ? errors.join(" · ")
      : answered === 0
        ? "Meta did not return a usable answer for any number. Some WhatsApp Business accounts do not allow the contacts lookup; the bad-numbers list still fills in from failed sends."
        : undefined,
  };
}
