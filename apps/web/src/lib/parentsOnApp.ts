/**
 * Parent app adoption, class by class (Comms → Parents on app; director,
 * 9 Oct 2026 — the old ERP's "Parent Mobile Usage Report"). Pure.
 *
 * What the server actually knows about a family and the app — nothing more:
 *  - signed in: every app sign-in writes an audit row (entity parent_session;
 *    only the app uses the parent OTP login);
 *  - notifications on: a push token for the household (push_device_tokens).
 *    The app registers it at every sign-in and launch, but only when the
 *    phone allows notifications — so the token's last_seen is a launch time;
 *  - opened: parent_app_presence, stamped by the app's home screen at most
 *    hourly whether or not notifications are allowed;
 *  - app version: the token's version, else the build the home screen sent.
 * "Last seen" is the latest of the three times.
 *
 * Who counts: a family with at least one child on roll this session (the
 * caller passes on-roll children only — lib/appPopups childrenOnRoll), once,
 * however many children it has. A family whose children are all inactive is
 * not a school family today (erp-inactive-family-block). A placeholder phone
 * (0000000000, 9999999999 …) is never a contact.
 */

import { isPlaceholderMobile } from "@/lib/sis";
import { householdCandidateNumbers } from "@/lib/waHouseholdNumbers";

export type AppDevice = { householdId: string; appVersion: string; createdAt: string; lastSeenAt: string };
/** One app sign-in (audit row). */
export type AppLogin = { householdId: string; at: string };
export type AppPresence = { householdId: string; firstSeenAt: string; lastSeenAt: string; appBuild: number | null };

export type RosterChild = {
  householdId: string;
  studentId: string;
  name: string;
  classId: string;
  className: string;
  classSort: number;
  sectionId: string;
  section: string;
  fatherMobile?: string;
  motherMobile?: string;
};

export type RosterFamily = {
  householdId: string;
  guardianName: string;
  whatsappMobile?: string;
  mobile?: string;
  altMobile?: string;
};

/** Seen in the last 7 days · 8–30 days · signed in but not for 30+ days · never. */
export type AdoptionStatus = "active7" | "active30" | "dormant" | "never";

export type FamilyRow = {
  householdId: string;
  guardianName: string;
  /** Real numbers only, in the order the school writes to them. */
  contacts: { mobile10: string; label: string }[];
  children: { studentId: string; name: string; className: string }[];
  /** Class·section keys this family has a child in. */
  classKeys: string[];
  signedIn: boolean;
  firstSignInAt: string;
  lastSignInAt: string;
  signIns: number;
  pushEnabled: boolean;
  phones: number;
  /** "1.0.25", or "build 26" when only the build is known; newest first. */
  versions: string[];
  /** Latest of sign-in, notification check-in and app open; "" if never. */
  lastSeenAt: string;
  status: AdoptionStatus;
};

export type ClassGroup = {
  key: string;
  classId: string;
  label: string;
  sort: number;
  families: number;
  signedIn: number;
  active7: number;
  active30: number;
  pushEnabled: number;
  never: number;
};

export type AdoptionSummary = {
  families: number;
  signedIn: number;
  never: number;
  /** Never signed in and no real phone number to invite them on. */
  neverNoContact: number;
  active7: number;
  /** Includes active7. */
  active30: number;
  pushEnabled: number;
  phones: number;
};

export type AdoptionReport = { summary: AdoptionSummary; classes: ClassGroup[]; families: FamilyRow[] };

const DAY = 86_400_000;

const maxIso = (xs: string[]) => xs.filter((x) => x && !Number.isNaN(Date.parse(x))).sort().at(-1) ?? "";
const minIso = (xs: string[]) => xs.filter((x) => x && !Number.isNaN(Date.parse(x))).sort()[0] ?? "";

/** Build number from "1.0.25+26"; null when absent. */
export function buildOfVersion(v: string): number | null {
  const m = /\+(\d+)\s*$/.exec(v || "");
  return m ? Number(m[1]) : null;
}

export function adoptionStatus(signedIn: boolean, lastSeenAt: string, now: Date): AdoptionStatus {
  if (!signedIn) return "never";
  const age = lastSeenAt ? now.getTime() - Date.parse(lastSeenAt) : Number.POSITIVE_INFINITY;
  if (age < 7 * DAY) return "active7";
  if (age < 30 * DAY) return "active30";
  return "dormant";
}

/** A family's real phone numbers (placeholders dropped), best first. */
export function familyContacts(family: RosterFamily, kids: RosterChild[]): { mobile10: string; label: string }[] {
  return householdCandidateNumbers({ household: family, students: kids })
    .filter((c) => !isPlaceholderMobile(c.mobile10))
    .map((c) => ({ mobile10: c.mobile10, label: c.label }));
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function buildParentsOnApp(input: {
  devices: AppDevice[];
  logins: AppLogin[];
  presence: AppPresence[];
  families: RosterFamily[];
  /** On-roll children only, one row each (this session's row). */
  children: RosterChild[];
  now?: Date;
}): AdoptionReport {
  const now = input.now ?? new Date();
  const devicesOf = groupBy(input.devices, (d) => d.householdId);
  const loginsOf = groupBy(input.logins, (l) => l.householdId);
  const presenceOf = new Map(input.presence.filter((p) => p.householdId).map((p) => [p.householdId, p]));
  const kidsOf = groupBy(input.children, (c) => c.householdId);
  const classKey = (c: RosterChild) => `${c.classId || "none"}:${c.sectionId || ""}`;

  const rows: FamilyRow[] = [];
  const seen = new Set<string>();
  for (const f of input.families) {
    if (!f.householdId || seen.has(f.householdId)) continue;
    const kids = [...(kidsOf.get(f.householdId) ?? [])].sort((a, b) => a.classSort - b.classSort || a.name.localeCompare(b.name));
    if (!kids.length) continue; // no child on roll — not a school family today
    seen.add(f.householdId);
    const devices = devicesOf.get(f.householdId) ?? [];
    const logins = loginsOf.get(f.householdId) ?? [];
    const presence = presenceOf.get(f.householdId);
    const signedIn = logins.length > 0 || devices.length > 0 || !!presence;
    const lastSeenAt = maxIso([
      ...logins.map((l) => l.at),
      ...devices.map((d) => d.lastSeenAt),
      presence?.lastSeenAt ?? "",
    ]);

    // Newest build first; a token's full version beats a bare build number.
    const byBuild = new Map<number, string>();
    for (const d of devices) {
      const b = buildOfVersion(d.appVersion);
      if (b != null) byBuild.set(b, d.appVersion.split("+")[0] ?? d.appVersion);
    }
    if (presence?.appBuild != null && !byBuild.has(presence.appBuild)) byBuild.set(presence.appBuild, `build ${presence.appBuild}`);
    const unnumbered = devices.map((d) => d.appVersion).filter((v) => v && buildOfVersion(v) == null);
    const versions = [...[...byBuild.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v), ...new Set(unnumbered)];

    rows.push({
      householdId: f.householdId,
      guardianName: f.guardianName,
      contacts: familyContacts(f, kids),
      children: kids.map((k) => ({
        studentId: k.studentId,
        name: k.name,
        className: [k.className, k.section].filter(Boolean).join(" "),
      })),
      classKeys: [...new Set(kids.map(classKey))],
      signedIn,
      firstSignInAt: minIso([...logins.map((l) => l.at), ...devices.map((d) => d.createdAt), presence?.firstSeenAt ?? ""]),
      lastSignInAt: maxIso(logins.map((l) => l.at)),
      signIns: logins.length,
      pushEnabled: devices.length > 0,
      phones: devices.length,
      versions,
      lastSeenAt,
      status: adoptionStatus(signedIn, lastSeenAt, now),
    });
  }

  // A family with children in two classes counts in both classes' rows.
  const groups = new Map<string, ClassGroup>();
  const rowOf = new Map(rows.map((r) => [r.householdId, r]));
  const counted = new Set<string>();
  for (const c of input.children) {
    const r = rowOf.get(c.householdId);
    if (!r) continue;
    const key = classKey(c);
    if (counted.has(`${key}|${r.householdId}`)) continue;
    counted.add(`${key}|${r.householdId}`);
    const g =
      groups.get(key) ??
      ({
        key,
        classId: c.classId || "none",
        label: [c.className, c.section].filter(Boolean).join(" ") || "Class not set",
        sort: c.classSort,
        families: 0,
        signedIn: 0,
        active7: 0,
        active30: 0,
        pushEnabled: 0,
        never: 0,
      } as ClassGroup);
    groups.set(key, g);
    g.families += 1;
    if (r.signedIn) g.signedIn += 1;
    else g.never += 1;
    if (r.status === "active7") g.active7 += 1;
    if (r.status === "active7" || r.status === "active30") g.active30 += 1;
    if (r.pushEnabled) g.pushEnabled += 1;
  }

  rows.sort((a, b) => (a.signedIn === b.signedIn ? a.guardianName.localeCompare(b.guardianName) : a.signedIn ? 1 : -1));
  const on = rows.filter((r) => r.signedIn);
  return {
    summary: {
      families: rows.length,
      signedIn: on.length,
      never: rows.length - on.length,
      neverNoContact: rows.filter((r) => !r.signedIn && !r.contacts.length).length,
      active7: rows.filter((r) => r.status === "active7").length,
      active30: rows.filter((r) => r.status === "active7" || r.status === "active30").length,
      pushEnabled: rows.filter((r) => r.pushEnabled).length,
      phones: rows.reduce((n, r) => n + r.phones, 0),
    },
    classes: [...groups.values()].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label)),
    families: rows,
  };
}

/** IST calendar day of an ISO time. */
const istDay = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

/** "just now", "25 min ago", "3 h ago", "yesterday", "4 days ago", else a date. */
export function lastSeenLabel(iso: string, now = new Date()): string {
  if (!iso) return "—";
  const ms = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  if (ms < 2 * 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min ago`;
  if (istDay(iso) === istDay(now.toISOString())) return `${Math.round(ms / 3_600_000)} h ago`;
  if (istDay(iso) === istDay(new Date(now.getTime() - DAY).toISOString())) return "yesterday";
  if (ms < 30 * DAY) return `${Math.max(2, Math.round(ms / DAY))} days ago`;
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

export const ADOPTION_STATUS_LABEL: Record<AdoptionStatus, string> = {
  active7: "Active this week",
  active30: "Active this month",
  dormant: "Not opened 30+ days",
  never: "Never signed in",
};
