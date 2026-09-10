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
import { loadSis, type Household } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { householdMobile10 } from "@/lib/parentHousehold.server";
import { recordWaNumberVerdicts } from "@/lib/waNumberHealth.server";
import {
  householdCandidateNumbers,
  type WaCandidateNumber,
} from "@/lib/waHouseholdNumbers";

export type WaRosterCheckResult = {
  ok: boolean;
  /** Numbers we asked about. */
  checked: number;
  onWhatsApp: number;
  notOnWhatsApp: number;
  /** Meta answered, but not for these — left unchecked rather than guessed. */
  noAnswer: number;
  /** The bad ones, named, so the answer is usable without another screen. */
  bad: {
    mobile: string;
    /** Which field it came from: "Father's number", etc. */
    label: string;
    guardianNames: string[];
    children: string[];
  }[];
  mode: string;
  error?: string;
};

/** Meta's contacts endpoint takes 100 at a time; `checkWhatsAppContacts` caps there too. */
const BATCH = 100;

/**
 * EVERY number an enrolled family has, not just the designated one.
 *
 * Checking only the primary was the first version of this and it answered
 * the wrong question: knowing the designated number is dead is no use
 * unless you also know whether the father's or the mother's number works,
 * because that is what the sender will fall to.
 */
function rosterCandidateNumbers(): {
  candidates: WaCandidateNumber[];
  /** Which families each number belongs to — a placeholder has several. */
  householdsByMobile: Map<string, Household[]>;
} {
  const sis = loadSis();
  const activeIds = new Set(
    (sis.students ?? [])
      .filter((s) => s.status === "active")
      .map((s) => s.householdId)
      .filter(Boolean),
  );
  const candidates: WaCandidateNumber[] = [];
  const householdsByMobile = new Map<string, Household[]>();
  const seen = new Set<string>();

  for (const h of sis.households ?? []) {
    if (!activeIds.has(h.id)) continue;
    const forHousehold = householdCandidateNumbers({
      household: h,
      students: (sis.students ?? []).filter(
        (s) => s.householdId === h.id && s.status === "active",
      ),
    });
    for (const c of forHousehold) {
      const list = householdsByMobile.get(c.mobile10) ?? [];
      if (!list.some((x) => x.id === h.id)) list.push(h);
      householdsByMobile.set(c.mobile10, list);
      if (seen.has(c.mobile10)) continue;
      seen.add(c.mobile10);
      candidates.push(c);
    }
  }
  return { candidates, householdsByMobile };
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
  const { candidates: roster, householdsByMobile } = rosterCandidateNumbers();
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
        "No active family had a usable mobile number — the roster may not have loaded, or every number stored is a placeholder.",
    };
  }

  const sis = loadSis();
  const students = sis.students ?? [];

  let onWhatsApp = 0;
  let notOnWhatsApp = 0;
  let answered = 0;
  const bad: WaRosterCheckResult["bad"] = [];
  const verdicts: { mobile: string; onWhatsApp: boolean }[] = [];
  let mode = "none";
  const errors: string[] = [];
  const byMobileLabel = new Map(roster.map((c) => [c.mobile10, c.label]));

  for (let i = 0; i < roster.length; i += BATCH) {
    const slice = roster.slice(i, i + BATCH).map((c) => c.mobile10);
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
      const hhs = householdsByMobile.get(m10) ?? [];
      const hhIds = new Set(hhs.map((h) => h.id));
      bad.push({
        mobile: m10,
        label: byMobileLabel.get(m10) || "Number on file",
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
