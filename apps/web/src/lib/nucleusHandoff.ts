/**
 * Handing a capture from the Nucleus tab to this ERP, without the clipboard.
 *
 * The office used to click the bookmark, wait, copy, switch tab, paste, and
 * press a button. Three of those six steps exist only because the capture had
 * nowhere to go but the clipboard — and the clipboard is also where it went
 * wrong: a capture run from the Console cannot write to it at all, because the
 * page has lost focus to DevTools.
 *
 * So the bookmark opens this ERP itself, at the moment it is clicked, and
 * posts the capture into it when the reading is finished. The office clicks
 * once and watches.
 *
 * Why this cannot start from a button on the ERP instead: the browser will not
 * let one site read another's pages, and Nucleus has no API and a captcha on
 * its login. Only code running inside the signed-in Nucleus tab can read it,
 * and only the person signed in can put it there. The click has to begin on
 * that side. What this removes is everything after the click.
 *
 * A `postMessage` can be sent by any page that has a handle on this window, so
 * nothing here is trusted on arrival. The origin must be the publisher's own,
 * exactly — `endsWith` would accept `nucleus.leadgroup.co.in.example.com` — and
 * the payload is still parsed by the same reader that parses a human paste,
 * still planned in the browser, and the addresses it names are still checked
 * against the publisher's file store by the server before anything is fetched.
 * This is a delivery route, not a source of authority.
 */

export const NUCLEUS_ORIGIN = "https://nucleus.leadgroup.co.in";

/** Which screen a capture belongs to; a reading of one is not the other. */
export type HandoffPage = "papers" | "timeliness";

/** The ERP says it is listening. Sent to the opener, never broadcast. */
export const HANDOFF_READY = "nucleus-capture-ready";
/** The Nucleus tab hands over a finished reading. */
export const HANDOFF_CAPTURE = "nucleus-capture";

/**
 * Comfortably past a full term — 108 papers reads as roughly 40 KB — and far
 * short of anything that would hurt to hold. A payload beyond this is not a
 * capture that grew; it is something else arriving.
 */
export const HANDOFF_MAX_CHARS = 4_000_000;

export type HandoffRead =
  | { ok: true; page: HandoffPage; payload: string }
  | {
      ok: false;
      why: string;
      /**
       * Whether the office should be told. A message from a browser extension,
       * or one meant for the other screen, is ordinary traffic: complaining
       * about it would train people to ignore the panel. Only a message that
       * really came from Nucleus and was still unusable is worth saying.
       */
      speak: boolean;
    };

function isPage(v: unknown): v is HandoffPage {
  return v === "papers" || v === "timeliness";
}

/**
 * Decide whether an arriving `message` event is a capture for this screen.
 *
 * @param origin the event's origin, as the browser reports it — never a value
 *               taken from inside the message.
 * @param data   the event's data, of entirely unknown shape.
 * @param want   the screen asking. A timeliness reading arriving at the papers
 *               desk is not an error; it is simply not for here.
 */
export function readHandoffMessage(
  origin: string,
  data: unknown,
  want: HandoffPage,
): HandoffRead {
  if (origin !== NUCLEUS_ORIGIN) {
    return { ok: false, why: `a message from ${origin || "an unnamed origin"}`, speak: false };
  }
  if (typeof data !== "object" || data === null) {
    return { ok: false, why: "a message with nothing in it", speak: false };
  }
  const msg = data as { kind?: unknown; page?: unknown; payload?: unknown };
  if (msg.kind !== HANDOFF_CAPTURE) {
    return { ok: false, why: "not a capture", speak: false };
  }
  if (!isPage(msg.page)) {
    return { ok: false, why: "the capture does not say which screen it is for", speak: true };
  }
  if (msg.page !== want) {
    return { ok: false, why: `a ${msg.page} capture, which belongs on another screen`, speak: false };
  }
  if (typeof msg.payload !== "string" || !msg.payload.trim()) {
    return { ok: false, why: "the capture arrived empty", speak: true };
  }
  if (msg.payload.length > HANDOFF_MAX_CHARS) {
    return {
      ok: false,
      why: `the capture is ${msg.payload.length} characters, past the ${HANDOFF_MAX_CHARS} this accepts`,
      speak: true,
    };
  }
  return { ok: true, page: msg.page, payload: msg.payload };
}

/**
 * Tell whoever opened this tab that the screen is listening.
 *
 * The bookmark opens the ERP at the moment it is clicked and then reads for
 * twelve minutes, so the ERP is ready long before there is anything to send.
 * It is the ERP that speaks first, and only ever to the publisher's origin, so
 * that nothing else on the web learns this tab is waiting.
 */
export function announceReady(win: Window = window): void {
  const opener = win.opener as Window | null;
  if (!opener) return;
  try {
    opener.postMessage({ kind: HANDOFF_READY }, NUCLEUS_ORIGIN);
  } catch {
    // An opener that has since closed or navigated away is not a fault: the
    // office can still paste.
  }
}

/**
 * Which desk the bookmark opens.
 *
 * The workspaces keep their tab in React state, not in the URL, so this is
 * read once on mount and never written back. Writing it back is what turned
 * the class WhatsApp screen into a poll storm: a `router.replace` on every
 * tab change, each one re-running the page.
 *
 * Read on the client only. Deciding the opening tab during a server render
 * would hand the browser a different first paint than the server's, which
 * React reports as a hydration failure.
 */
export function urlAsksForTab(search: string, tab: string): boolean {
  try {
    return new URLSearchParams(search).get("tab") === tab;
  } catch {
    return false;
  }
}

/** Where the bookmark should send each kind of reading. */
export const HANDOFF_PATH: Record<HandoffPage, string> = {
  papers: "/exams?tab=papers",
  timeliness: "/teaching?tab=nucleus",
};
