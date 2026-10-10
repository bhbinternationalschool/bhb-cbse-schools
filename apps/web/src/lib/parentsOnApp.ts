/**
 * Which families have the parent app, class by class (Comms → Parents on
 * app; director, 9 Oct 2026). A family is "on the app" when one of its
 * phones registered for notifications — the app does that at every sign-in
 * and every launch, so the phone's last_seen is when it was last opened.
 * Pure.
 */

export type AppDevice = { householdId: string; appVersion: string; createdAt: string; lastSeenAt: string };

export type RosterChild = {
  householdId: string;
  /** One row per child even with per-year duplicates (admission no. or id). */
  key: string;
  name: string;
  classId: string;
  className: string;
  classSort: number;
  section: string;
};

export type RosterFamily = { householdId: string; guardianName: string; mobile: string };

export type FamilyRow = {
  householdId: string;
  guardianName: string;
  mobile: string;
  children: { name: string; className: string }[];
  phones: number;
  versions: string[];
  /** First sign-in on the app; "" when not on the app. */
  joinedAt: string;
  lastSeenAt: string;
};

export type ClassGroup = {
  classId: string;
  className: string;
  sort: number;
  families: number;
  onApp: FamilyRow[];
  notOnApp: FamilyRow[];
};

export type ParentsOnAppSummary = {
  families: number;
  familiesOnApp: number;
  phones: number;
  openedToday: number;
  openedThisWeek: number;
  /** On the app but not opened for 7 days or more. */
  quiet: number;
};

const DAY = 86_400_000;

/** IST calendar day of an ISO time. */
const istDay = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

export function buildParentsOnApp(input: {
  devices: AppDevice[];
  families: RosterFamily[];
  children: RosterChild[];
  now?: Date;
}): { summary: ParentsOnAppSummary; classes: ClassGroup[] } {
  const now = input.now ?? new Date();
  const byFamily = new Map<string, AppDevice[]>();
  for (const d of input.devices) {
    if (!d.householdId) continue;
    byFamily.set(d.householdId, [...(byFamily.get(d.householdId) ?? []), d]);
  }
  const kidsOf = new Map<string, RosterChild[]>();
  for (const c of input.children) kidsOf.set(c.householdId, [...(kidsOf.get(c.householdId) ?? []), c]);

  const rows = new Map<string, FamilyRow>();
  for (const f of input.families) {
    const kids = (kidsOf.get(f.householdId) ?? []).sort((a, b) => a.classSort - b.classSort);
    if (!kids.length) continue; // no child on roll — not a school family today
    const devices = byFamily.get(f.householdId) ?? [];
    const times = (pick: (d: AppDevice) => string) => devices.map(pick).filter(Boolean).sort();
    rows.set(f.householdId, {
      householdId: f.householdId,
      guardianName: f.guardianName,
      mobile: f.mobile,
      children: kids.map((k) => ({ name: k.name, className: [k.className, k.section].filter(Boolean).join(" ") })),
      phones: devices.length,
      versions: [...new Set(devices.map((d) => d.appVersion).filter(Boolean))].sort(),
      joinedAt: times((d) => d.createdAt)[0] ?? "",
      lastSeenAt: times((d) => d.lastSeenAt).at(-1) ?? "",
    });
  }

  // A family with children in two classes is listed under both.
  const groups = new Map<string, ClassGroup>();
  for (const c of input.children) {
    const row = rows.get(c.householdId);
    if (!row) continue;
    const g =
      groups.get(c.classId) ??
      ({ classId: c.classId, className: c.className || "No class", sort: c.classSort, families: 0, onApp: [], notOnApp: [] } as ClassGroup);
    groups.set(c.classId, g);
    const list = row.phones ? g.onApp : g.notOnApp;
    if (!list.some((r) => r.householdId === row.householdId)) list.push(row);
  }
  for (const g of groups.values()) {
    g.families = g.onApp.length + g.notOnApp.length;
    g.onApp.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    g.notOnApp.sort((a, b) => a.guardianName.localeCompare(b.guardianName));
  }

  const all = [...rows.values()];
  const on = all.filter((r) => r.phones > 0);
  const today = istDay(now.toISOString());
  return {
    summary: {
      families: all.length,
      familiesOnApp: on.length,
      phones: on.reduce((n, r) => n + r.phones, 0),
      openedToday: on.filter((r) => r.lastSeenAt && istDay(r.lastSeenAt) === today).length,
      openedThisWeek: on.filter((r) => r.lastSeenAt && now.getTime() - Date.parse(r.lastSeenAt) < 7 * DAY).length,
      quiet: on.filter((r) => !r.lastSeenAt || now.getTime() - Date.parse(r.lastSeenAt) >= 7 * DAY).length,
    },
    classes: [...groups.values()].sort((a, b) => a.sort - b.sort || a.className.localeCompare(b.className)),
  };
}

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
