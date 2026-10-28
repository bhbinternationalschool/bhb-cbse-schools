/**
 * The parent-app notification for a bus register tap (director, 13 Oct 2026:
 * "bus message to parents go in parents app notification").
 *
 * App notification only — no WhatsApp: a template per tap would cost a paid
 * message twice a day per child, and the app is where the family already
 * looks. Pure, so the rules are self-tested (busMarkPush.selftest.ts); the
 * route (api/v1/transport/register/mark) does the sending.
 *
 * When a tap tells the family — and when it must not:
 *  - the tap was applied (a stale retry the server ignored changes nothing);
 *  - the status really changed (a retry of the same tap is not news);
 *  - it is today's run in India (an office correction of last week is
 *    bookkeeping, not an event);
 *  - the tap is fresh: a phone that was offline and sends its taps an hour
 *    later must not tell a parent "boarded" when the child is long at school;
 *  - "unmarked" (an undone tap) says nothing.
 */

export type BusMarkStatus = "boarded" | "dropped" | "not_boarded" | "unmarked";

/** A tap older than this when it reaches the server tells nobody. */
export const BUS_PUSH_FRESH_MS = 20 * 60_000;

export type BusMarkPushInput = {
  applied: boolean;
  status: BusMarkStatus;
  /** The child's status on this trip before the tap ("unmarked" if none). */
  previous: BusMarkStatus;
  runDate: string;
  /** Today in India, yyyy-mm-dd. */
  today: string;
  tappedAt: string;
  nowMs: number;
  trip: "AM" | "PM";
  childName: string;
  stopName: string;
  lang: "hi" | "en";
};

export type BusMarkPush = {
  title: string;
  body: string;
  url: string;
  data: Record<string, string>;
};

/** "07:42" in India from an ISO time; "" when unreadable. */
export function istClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 330 * 60_000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** Is this tap news for the family? Cheap — checked before any roster read. */
export function busMarkIsNews(
  input: Pick<BusMarkPushInput, "applied" | "status" | "previous" | "runDate" | "today" | "tappedAt" | "nowMs">,
): boolean {
  if (!input.applied) return false;
  if (input.status === "unmarked") return false;
  if (input.status === input.previous) return false;
  if (input.runDate !== input.today) return false;
  const tapped = Date.parse(input.tappedAt);
  return Number.isFinite(tapped) && input.nowMs - tapped <= BUS_PUSH_FRESH_MS;
}

export function busMarkPush(input: BusMarkPushInput): BusMarkPush | null {
  if (!busMarkIsNews(input)) return null;

  const child = input.childName.trim();
  if (!child) return null;
  const time = istClock(input.tappedAt);
  const stop = input.stopName.trim();
  const hi = input.lang === "hi";

  let title: string;
  let body: string;
  if (input.status === "boarded") {
    title = hi ? `बस में: ${child}` : `On the bus: ${child}`;
    body = hi
      ? `${stop ? `${stop} पर ` : ""}बस में सवार · ${time}`
      : `Boarded${stop ? ` at ${stop}` : ""} · ${time}`;
  } else if (input.status === "dropped") {
    title = hi ? `बस से उतरे: ${child}` : `Dropped off: ${child}`;
    body = hi
      ? `${stop ? `${stop} पर ` : ""}बस से उतारा गया · ${time}`
      : `Got off the bus${stop ? ` at ${stop}` : ""} · ${time}`;
  } else {
    title = hi ? `बस में नहीं: ${child}` : `Not on the bus: ${child}`;
    body = hi
      ? `${input.trip === "AM" ? "सुबह" : "छुट्टी के बाद"} बस में सवार नहीं${stop ? ` (${stop})` : ""} · ${time}। गलत हो तो विद्यालय को फ़ोन करें।`
      : `Marked not boarded on the ${input.trip === "AM" ? "morning" : "home-time"} bus${stop ? ` (${stop})` : ""} · ${time}. Call the school if this is wrong.`;
  }
  return {
    title,
    body,
    url: "/transport",
    data: { kind: "bus_mark", status: input.status, trip: input.trip },
  };
}
