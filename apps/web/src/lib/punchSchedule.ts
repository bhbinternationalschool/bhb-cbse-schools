/**
 * When staff may punch, and the printed backup QR (director, 5 Oct 2026).
 *
 * The gate phone shows the rotating QR only inside the window, and the
 * server refuses every punch outside it — screen code, printed QR and
 * WhatsApp alike — so a photo taken at 9 AM is no use at 9 PM.
 *
 * The printed QR is a backup for when the gate phone is off. It cannot
 * rotate, so it proves only "this is the school's gate"; what stops a photo
 * of it from working at home is everything else a punch already needs: the
 * staff member's OWN registered phone, a live GPS fix inside the campus
 * (stricter accuracy for printed punches), the window, and the register
 * marking the punch "Printed QR" for the office to watch. Reprinting
 * (version + 1) kills every old copy.
 *
 * Pure — the secret is passed in; IST everywhere.
 */
import { createHmac, timingSafeEqual } from "crypto";

export type PunchOptions = {
  /** "HH:mm" IST — QR shown and punches accepted from … */
  windowStart: string;
  /** … until (inclusive of the minute). */
  windowEnd: string;
  /** ISO weekday numbers the window applies on (1 = Monday … 7 = Sunday). */
  days: number[];
  printedQrEnabled: boolean;
  /** Bumped by "New printed QR" — every earlier print stops working. */
  printedQrVersion: number;
  printedQrIssuedAt: string | null;
};

export function defaultPunchOptions(): PunchOptions {
  return {
    windowStart: "06:45",
    windowEnd: "18:00",
    days: [1, 2, 3, 4, 5, 6],
    printedQrEnabled: false,
    printedQrVersion: 1,
    printedQrIssuedAt: null,
  };
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/** Anything unreadable falls back to the default, never to "always open". */
export function normalizePunchOptions(raw: unknown): PunchOptions {
  const d = defaultPunchOptions();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<PunchOptions>;
  let start = typeof r.windowStart === "string" && HHMM.test(r.windowStart) ? r.windowStart : d.windowStart;
  let end = typeof r.windowEnd === "string" && HHMM.test(r.windowEnd) ? r.windowEnd : d.windowEnd;
  if (minutes(end) <= minutes(start)) {
    start = d.windowStart;
    end = d.windowEnd;
  }
  const days = Array.isArray(r.days)
    ? [...new Set(r.days.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort()
    : d.days;
  const version = Number(r.printedQrVersion);
  return {
    windowStart: start,
    windowEnd: end,
    days: days.length ? days : d.days,
    printedQrEnabled: r.printedQrEnabled === true,
    printedQrVersion: Number.isInteger(version) && version >= 1 ? version : d.printedQrVersion,
    printedQrIssuedAt: typeof r.printedQrIssuedAt === "string" ? r.printedQrIssuedAt : null,
  };
}

/** IST wall clock for an instant. */
export function istParts(nowMs: number): { minutes: number; isoWeekday: number; date: string } {
  const ist = new Date(nowMs + 330 * 60_000);
  const dow = ist.getUTCDay();
  return {
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    isoWeekday: dow === 0 ? 7 : dow,
    date: ist.toISOString().slice(0, 10),
  };
}

export type PunchWindowState =
  | { open: true; closesAt: string }
  | { open: false; opensAt: string; opensToday: boolean; reason: "before" | "after" | "day_off" };

/** Is the gate open for punching right now? */
export function punchWindowState(opts: PunchOptions, nowMs: number): PunchWindowState {
  const { minutes: now, isoWeekday } = istParts(nowMs);
  const start = minutes(opts.windowStart);
  const end = minutes(opts.windowEnd);
  const today = opts.days.includes(isoWeekday);
  if (today && now >= start && now <= end) return { open: true, closesAt: opts.windowEnd };
  if (today && now < start) return { open: false, opensAt: opts.windowStart, opensToday: true, reason: "before" };
  return { open: false, opensAt: opts.windowStart, opensToday: false, reason: today ? "after" : "day_off" };
}

/** The sentence a refused punch shows. */
export function punchWindowMessage(opts: PunchOptions, state: PunchWindowState): string {
  if (state.open) return "";
  if (state.reason === "day_off") return "Attendance punching is closed today.";
  return `Attendance punching is open ${opts.windowStart}–${opts.windowEnd} IST. ${
    state.opensToday ? `It opens at ${state.opensAt}.` : "It opens again on the next working day."
  }`;
}

// ----------------------------------------------------------- printed QR

/** The token printed on the gate QR for this version. */
export function printedQrToken(secret: string, version: number): string {
  return createHmac("sha256", secret)
    .update(`punch-place|gate|v${version}`)
    .digest("base64url")
    .slice(0, 22);
}

/** Does a scanned token match the CURRENT print? Constant-time. */
export function verifyPrintedQrToken(secret: string, version: number, raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const got = raw.trim();
  const want = printedQrToken(secret, version);
  if (got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** What the printed QR encodes — the punch page, carrying the token. */
export function printedQrLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/punch?p=${encodeURIComponent(token)}`;
}

/** Printed punches need a tighter GPS fix than screen punches. */
export const PRINTED_QR_MAX_ACCURACY_M = 50;
