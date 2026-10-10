/**
 * Online classes — shapes, validation and the small pure rules.
 *
 * No I/O here. onlineClasses.server.ts persists and notifies; the routes
 * decide who may do what. Kept pure so the rules below have a self-test.
 */

export type OnlineClassProvider = "google_meet" | "link";
export type OnlineClassStatus = "scheduled" | "live" | "ended" | "cancelled";

export type OnlineClassSession = {
  id: string;
  academicYearCode: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  title: string;
  /** YYYY-MM-DD, IST calendar date. */
  date: string;
  /** HH:MM, 24h, IST. */
  startTime: string;
  endTime: string;
  periodNo: number | null;
  provider: OnlineClassProvider;
  joinUrl: string;
  meetingCode: string;
  meetSpaceName: string;
  status: OnlineClassStatus;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  endedAt: string;
  cancelledAt: string;
  announcedAt: string;
  remindedAt: string;
  attendanceSyncedAt: string;
};

export type OnlineClassJoin = {
  id: string;
  sessionId: string;
  studentId: string;
  householdId: string;
  source: "app" | "web" | "meet_sync";
  displayName: string;
  firstJoinedAt: string;
  lastJoinedAt: string;
  minutes: number;
};

/** What a scheduling form may send. */
export type OnlineClassInput = {
  classId: string;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  periodNo: number | null;
  provider: OnlineClassProvider;
  joinUrl: string;
  note: string;
};

export type OnlineClassInputError =
  | "section_required"
  | "date_invalid"
  | "time_invalid"
  | "time_order"
  | "too_long"
  | "provider_invalid"
  | "link_required"
  | "link_invalid"
  | "title_too_long";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes since midnight for HH:MM, or NaN. */
export function timeToMinutes(t: string): number {
  if (!TIME_RE.test(t || "")) return NaN;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Only https links, and only to hosts a school would plausibly hold a
 * class on. A pasted "meet.google.com/abc-defg-hij" without a scheme is
 * accepted and normalised. Anything else is refused: a link is sent to
 * every household in a section, so an odd URL is a phishing vector
 * dressed as a class.
 */
const LINK_HOSTS = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "teams.live.com",
  "youtube.com",
  "youtu.be",
  "meet.jit.si",
  "whereby.com",
  "webex.com",
];

export function normalizeJoinUrl(raw: string): string | null {
  let s = (raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const allowed = LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed) return null;
  return u.toString();
}

export function readOnlineClassInput(
  raw: Partial<Record<keyof OnlineClassInput, unknown>>,
):
  | { ok: true; value: OnlineClassInput }
  | { ok: false; error: OnlineClassInputError } {
  const classId = String(raw.classId ?? "").trim();
  const sectionId = String(raw.sectionId ?? "").trim();
  if (!classId || !sectionId) return { ok: false, error: "section_required" };
  const date = String(raw.date ?? "").trim();
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { ok: false, error: "date_invalid" };
  }
  const startTime = String(raw.startTime ?? "").trim();
  const endTime = String(raw.endTime ?? "").trim();
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  if (Number.isNaN(s) || Number.isNaN(e)) return { ok: false, error: "time_invalid" };
  if (e <= s) return { ok: false, error: "time_order" };
  if (e - s > 4 * 60) return { ok: false, error: "too_long" };
  const provider = String(raw.provider ?? "link") as OnlineClassProvider;
  if (provider !== "google_meet" && provider !== "link") {
    return { ok: false, error: "provider_invalid" };
  }
  let joinUrl = "";
  if (provider === "link") {
    const rawUrl = String(raw.joinUrl ?? "").trim();
    if (!rawUrl) return { ok: false, error: "link_required" };
    const norm = normalizeJoinUrl(rawUrl);
    if (!norm) return { ok: false, error: "link_invalid" };
    joinUrl = norm;
  }
  const title = String(raw.title ?? "").replace(/\s+/g, " ").trim();
  if (title.length > 120) return { ok: false, error: "title_too_long" };
  const periodRaw = raw.periodNo;
  const periodNo =
    periodRaw === null || periodRaw === undefined || periodRaw === ""
      ? null
      : Number.isInteger(Number(periodRaw)) && Number(periodRaw) > 0
        ? Number(periodRaw)
        : null;
  return {
    ok: true,
    value: {
      classId,
      sectionId,
      subjectId: String(raw.subjectId ?? "").trim(),
      teacherId: String(raw.teacherId ?? "").trim(),
      title,
      date,
      startTime,
      endTime,
      periodNo,
      provider,
      joinUrl,
      note: String(raw.note ?? "").trim().slice(0, 500),
    },
  };
}

export function onlineClassInputMessage(e: OnlineClassInputError): string {
  switch (e) {
    case "section_required":
      return "Pick the class and section.";
    case "date_invalid":
      return "Pick a date.";
    case "time_invalid":
      return "Give a start and end time (HH:MM).";
    case "time_order":
      return "The class must end after it starts.";
    case "too_long":
      return "A class cannot run longer than four hours.";
    case "provider_invalid":
      return "Choose Google Meet or a pasted link.";
    case "link_required":
      return "Paste the meeting link.";
    case "link_invalid":
      return "That link is not a meeting link the school can send to parents (Google Meet, Zoom, Teams, YouTube, Jitsi).";
    case "title_too_long":
      return "Shorten the title.";
  }
}

// ─── Time ────────────────────────────────────────────────────────────

/** IST 'now' as a calendar date and minutes-since-midnight. */
export function istNow(at: Date = new Date()): { date: string; minutes: number } {
  const ist = new Date(at.getTime() + 5.5 * 60 * 60 * 1000);
  return {
    date: ist.toISOString().slice(0, 10),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

/** Absolute instant of an IST date + HH:MM. */
export function istInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}

/** Parents may join from this many minutes before the start. */
export const JOIN_OPENS_BEFORE_MIN = 10;
/** A class nobody ended is closed this long after its end time. */
export const AUTO_END_AFTER_MIN = 30;
/** The "starting soon" nudge goes out this many minutes before. */
export const REMIND_BEFORE_MIN = 15;

export type OnlineClassPhase =
  | "upcoming"
  | "joinable"
  | "live"
  | "over"
  | "cancelled";

/**
 * What a parent should see on a row right now. `live` is the teacher's
 * word; `joinable` is the clock's (the window has opened, the teacher has
 * not pressed Start). Both show a Join button — a child who joins a minute
 * before the teacher just waits in the room.
 */
export function onlineClassPhase(
  s: Pick<OnlineClassSession, "date" | "startTime" | "endTime" | "status">,
  at: Date = new Date(),
): OnlineClassPhase {
  if (s.status === "cancelled") return "cancelled";
  if (s.status === "ended") return "over";
  if (s.status === "live") return "live";
  const start = istInstant(s.date, s.startTime).getTime();
  const end = istInstant(s.date, s.endTime).getTime();
  const now = at.getTime();
  if (now >= end + AUTO_END_AFTER_MIN * 60_000) return "over";
  if (now >= start - JOIN_OPENS_BEFORE_MIN * 60_000) return "joinable";
  return "upcoming";
}

export function canJoinNow(
  s: Pick<OnlineClassSession, "date" | "startTime" | "endTime" | "status">,
  at: Date = new Date(),
): boolean {
  const p = onlineClassPhase(s, at);
  return p === "joinable" || p === "live";
}

/** Should the reminder tick nudge this session now? */
export function reminderDue(
  s: Pick<OnlineClassSession, "date" | "startTime" | "status" | "remindedAt">,
  at: Date = new Date(),
): boolean {
  if (s.status !== "scheduled" || s.remindedAt) return false;
  const start = istInstant(s.date, s.startTime).getTime();
  const now = at.getTime();
  // Inside the window, and not so late that the class has already begun.
  return now >= start - REMIND_BEFORE_MIN * 60_000 && now < start;
}

/** Should the tick close this session as ended? */
export function autoEndDue(
  s: Pick<OnlineClassSession, "date" | "endTime" | "status">,
  at: Date = new Date(),
): boolean {
  if (s.status !== "scheduled" && s.status !== "live") return false;
  const end = istInstant(s.date, s.endTime).getTime();
  return at.getTime() >= end + AUTO_END_AFTER_MIN * 60_000;
}

export function sortSessions<T extends Pick<OnlineClassSession, "date" | "startTime">>(
  rows: T[],
  dir: "asc" | "desc" = "asc",
): T[] {
  const k = dir === "asc" ? 1 : -1;
  return rows
    .slice()
    .sort(
      (a, b) =>
        k * (a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)),
    );
}

export function phaseLabel(p: OnlineClassPhase): string {
  switch (p) {
    case "upcoming":
      return "Upcoming";
    case "joinable":
      return "Starting";
    case "live":
      return "Live";
    case "over":
      return "Over";
    case "cancelled":
      return "Cancelled";
  }
}

/**
 * Loose name match for the Meet participant sync: a child signed in on a
 * parent's phone shows the parent's Google name, a child on their own
 * account may be "Aarav K", and the roster says "Aarav Kumar". We accept
 * a match on the first name plus initial of the last, or the full name
 * either way round; anything weaker is left for the teacher to decide.
 */
export function matchParticipantToRoster(
  displayName: string,
  roster: { studentId: string; fullName: string }[],
): string | null {
  const norm = (s: string) =>
    (s || "")
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const dn = norm(displayName);
  if (!dn) return null;
  const dParts = dn.split(" ");
  const exact = roster.filter((r) => norm(r.fullName) === dn);
  if (exact.length === 1) return exact[0].studentId;
  if (exact.length > 1) return null;
  const partial = roster.filter((r) => {
    const rp = norm(r.fullName).split(" ");
    if (rp[0] !== dParts[0]) return false;
    if (dParts.length === 1 || rp.length === 1) return true;
    const dl = dParts[dParts.length - 1];
    const rl = rp[rp.length - 1];
    return rl === dl || rl.startsWith(dl) || dl.startsWith(rl);
  });
  return partial.length === 1 ? partial[0].studentId : null;
}

// ─── Register proposal ───────────────────────────────────────────────

/**
 * What the register should be pre-filled with from an online class. The
 * register already marked for that date wins outright — an online join is a
 * suggestion, and a class teacher's earlier mark is a decision. Otherwise a
 * child who joined is proposed present and everyone else absent, and the
 * teacher corrects before saving. Nothing here saves.
 */
export function proposeRegisterStatus(
  joined: boolean,
  existingStatus: string | null | undefined,
): "P" | "A" | "L" | "HD" | "LE" {
  if (existingStatus === "P" || existingStatus === "A" || existingStatus === "L" || existingStatus === "HD" || existingStatus === "LE") {
    return existingStatus;
  }
  return joined ? "P" : "A";
}
