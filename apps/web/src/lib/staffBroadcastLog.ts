/**
 * What staff sent through /api/v1/staff/broadcast (13 Oct 2026).
 *
 * The route used to keep no record of its own: a teacher who messaged their
 * class could not see what went out, and the office could not see who sent
 * what to whom. Every LIVE send is now appended here (module_local_state
 * "staff_broadcasts", written only by the server). Dry runs are previews and
 * are not logged. Pure — the read / write lives in staffBroadcastLog.server.ts.
 */

export type StaffBroadcastEntry = {
  id: string;
  at: string;
  staffId: string;
  staffName: string;
  /**
   * "audience" = the app's Broadcast screen (20 Oct 2026): any audience the
   * web offers, named in `audienceLabel`.
   */
  audience: "class_parents" | "leadership" | "audience";
  /** "Parents of 5-A + 5-B", "Teaching staff" — set for "audience" sends. */
  audienceLabel?: string;
  /** "template" or "custom" — set for "audience" sends. */
  mode?: "template" | "custom";
  /** Custom sends: how many went as free text and how many in the template. */
  viaFreeText?: number;
  viaTemplate?: number;
  sectionIds: string[];
  /** "Class 5 A", as the sections were named when the message went out. */
  sectionLabels: string[];
  /** The free text, or "" when an approved template was sent. */
  body: string;
  templateName: string;
  /** Families (households) the message was addressed to. */
  families: number;
  /** WhatsApp numbers after opt-outs were removed. */
  recipientCount: number;
  skippedOptOut: number;
  sent: number;
  failed: number;
  pushSent: number;
};

export type StaffBroadcastLog = { version: 1; entries: StaffBroadcastEntry[] };

/** Oldest entries fall off past this — the log is a record, not an archive. */
export const STAFF_BROADCAST_LOG_CAP = 2000;

export function emptyStaffBroadcastLog(): StaffBroadcastLog {
  return { version: 1, entries: [] };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function normalizeStaffBroadcastLog(raw: unknown): StaffBroadcastLog {
  const o = (raw && typeof raw === "object" ? raw : {}) as { entries?: unknown };
  const entries: StaffBroadcastEntry[] = [];
  for (const e of Array.isArray(o.entries) ? o.entries : []) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const id = str(r.id);
    const staffId = str(r.staffId);
    if (!id || !staffId) continue;
    entries.push({
      id,
      at: str(r.at),
      staffId,
      staffName: str(r.staffName),
      audience:
        r.audience === "leadership"
          ? "leadership"
          : r.audience === "audience"
            ? "audience"
            : "class_parents",
      ...(r.audience === "audience"
        ? {
            audienceLabel: str(r.audienceLabel),
            mode: r.mode === "custom" ? ("custom" as const) : ("template" as const),
            viaFreeText: num(r.viaFreeText),
            viaTemplate: num(r.viaTemplate),
          }
        : {}),
      sectionIds: strs(r.sectionIds),
      sectionLabels: strs(r.sectionLabels),
      body: str(r.body),
      templateName: str(r.templateName),
      families: num(r.families),
      recipientCount: num(r.recipientCount),
      skippedOptOut: num(r.skippedOptOut),
      sent: num(r.sent),
      failed: num(r.failed),
      pushSent: num(r.pushSent),
    });
  }
  return { version: 1, entries };
}

/** Newest first; never more than the cap. */
export function withBroadcastEntry(
  log: StaffBroadcastLog,
  entry: StaffBroadcastEntry,
): StaffBroadcastLog {
  const entries = [entry, ...log.entries.filter((e) => e.id !== entry.id)];
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return { version: 1, entries: entries.slice(0, STAFF_BROADCAST_LOG_CAP) };
}

/** One person's own sends, newest first. */
export function broadcastsBy(
  log: StaffBroadcastLog,
  staffId: string,
  limit = 50,
): StaffBroadcastEntry[] {
  if (!staffId) return [];
  return log.entries
    .filter((e) => e.staffId === staffId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
