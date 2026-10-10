/**
 * Google's India holiday calendar, turned into draft holidays for Masters.
 *
 * Imported as DRAFTS, never published. Google lists every gazetted and
 * restricted holiday in India, and a school closes for the ones it chooses —
 * that is a decision, not a feed. Publishing straight from it would close the
 * school on days it actually works, and attendance and payroll both read this
 * calendar: children marked absent on a working day, staff paid for a holiday
 * they worked.
 *
 * So this proposes; a person confirms. `isPublished` already gates everything
 * downstream, so an unconfirmed row changes nothing.
 */

export type GoogleHolidayEvent = {
  /** The holiday's name, e.g. "Independence Day". */
  summary?: string;
  /** Google puts the classification here: "Public holiday", "Observance"… */
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

export type HolidayDraft = {
  title: string;
  startsOn: string;
  endsOn: string;
  kind: "gazetted" | "restricted";
  /** What Google called it, kept so the office can judge before publishing. */
  sourceNote: string;
};

export type ImportPlan = {
  drafts: HolidayDraft[];
  /** Events left out, and why — shown rather than silently dropped. */
  skipped: { title: string; reason: string }[];
};

/**
 * States whose own holidays should not be proposed for a school in UP.
 *
 * Google's India feed is one calendar for the whole country and does NOT
 * carry a state field, so this reads the only signal there is: the name and
 * description. It is a filter, not a guarantee — which is exactly why nothing
 * here publishes itself.
 */
const OTHER_STATE_MARKERS = [
  "andhra", "arunachal", "assam", "bihar", "chhattisgarh", "goa", "gujarat",
  "haryana", "himachal", "jharkhand", "karnataka", "kerala", "madhya pradesh",
  "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland", "odisha",
  "orissa", "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana",
  "tripura", "west bengal", "bengal", "jammu", "kashmir", "ladakh",
  "puducherry", "pondicherry", "andaman", "lakshadweep", "daman", "diu",
  "dadra", "chandigarh", "mumbai", "chennai", "kolkata", "bengaluru",
];

/**
 * Names that are days of note but not days the school shuts.
 *
 * Google marks these "Observance", but the wording varies by locale, so the
 * classification is checked first and this is only a backstop.
 */
const OBSERVANCE_MARKERS = ["observance", "season", "day of", "awareness"];

function isoOf(v: { date?: string; dateTime?: string } | undefined): string {
  if (!v) return "";
  if (v.date) return v.date.slice(0, 10);
  if (v.dateTime) return v.dateTime.slice(0, 10);
  return "";
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mapGoogleHolidays(
  events: GoogleHolidayEvent[],
  opts: { from: string; to: string },
): ImportPlan {
  const drafts: HolidayDraft[] = [];
  const skipped: { title: string; reason: string }[] = [];

  for (const e of events) {
    const title = (e.summary ?? "").trim();
    if (!title) continue;

    const startsOn = isoOf(e.start);
    if (!startsOn) {
      skipped.push({ title, reason: "no date" });
      continue;
    }
    // An all-day event's end date is EXCLUSIVE in Google's API: a one-day
    // holiday on the 15th ends on the 16th. Taking it literally would close
    // the school for a day it works, every single time.
    const rawEnd = isoOf(e.end);
    const endsOn = rawEnd && rawEnd > startsOn ? addDays(rawEnd, -1) : startsOn;

    if (startsOn < opts.from || startsOn > opts.to) {
      skipped.push({ title, reason: "outside the session" });
      continue;
    }

    const haystack = `${title} ${e.description ?? ""}`.toLowerCase();
    const classification = (e.description ?? "").toLowerCase();

    if (
      classification.includes("observance") ||
      OBSERVANCE_MARKERS.some((m) => classification.includes(m))
    ) {
      skipped.push({ title, reason: "an observance, not a closure" });
      continue;
    }

    const otherState = OTHER_STATE_MARKERS.find(
      (m) => haystack.includes(m) && !haystack.includes("uttar pradesh"),
    );
    if (otherState) {
      skipped.push({ title, reason: `looks specific to ${otherState}` });
      continue;
    }

    drafts.push({
      title,
      startsOn,
      endsOn,
      // Restricted holidays are optional in India — proposed, but the office
      // decides, which is the whole point of importing as drafts.
      kind: classification.includes("restricted") ? "restricted" : "gazetted",
      sourceNote: (e.description ?? "Google Calendar").trim() || "Google Calendar",
    });
  }

  drafts.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return { drafts, skipped };
}

/**
 * Drop anything the school already has, so re-importing adds only what is new.
 *
 * Matched on the date AND a normalised title: the same festival can be spelt
 * differently year to year ("Dussehra" / "Dasara"), but two rows on one date
 * with the same name are the same holiday.
 */
export function dropAlreadyPresent(
  drafts: HolidayDraft[],
  existing: { title: string; startsOn: string }[],
): { fresh: HolidayDraft[]; alreadyThere: number } {
  const key = (t: string, d: string) =>
    `${d}|${t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  const have = new Set(existing.map((h) => key(h.title, h.startsOn)));
  const fresh = drafts.filter((d) => !have.has(key(d.title, d.startsOn)));
  return { fresh, alreadyThere: drafts.length - fresh.length };
}
