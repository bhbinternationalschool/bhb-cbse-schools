/**
 * Numbers that tried to log in to the app but are not in the ERP (director,
 * 9 Oct 2026). The day parent OTP login was fixed, 40 OTP requests in one
 * evening were answered "No parent record found for this mobile" — families
 * who want the app and cannot get in, with nobody told. The server records
 * each such number here; the office calls them and adds the number to the
 * family (or marks it done with a note).
 *
 * module_local_state "login_unknown_numbers" (rbac: students). Written only
 * by the server; the browser reads it through the comms route. Pure.
 */

export type LoginApp = "parent" | "staff";

export type UnknownLoginNumber = {
  mobile10: string;
  app: LoginApp;
  attempts: number;
  firstAt: string;
  lastAt: string;
  /** Set when the office has dealt with it. A new attempt after that reopens it. */
  doneAt: string;
  doneBy: string;
  note: string;
};

export type UnknownLoginState = { version: 1; numbers: UnknownLoginNumber[] };

/** Most recent numbers kept; older handled ones drop off first. */
export const UNKNOWN_LOGIN_CAP = 500;

export function emptyUnknownLoginState(): UnknownLoginState {
  return { version: 1, numbers: [] };
}

export function normalizeUnknownLoginState(raw: unknown): UnknownLoginState {
  const r = (raw ?? {}) as Partial<UnknownLoginState>;
  const numbers = Array.isArray(r.numbers)
    ? r.numbers
        .filter((n) => n && /^\d{10}$/.test(String(n.mobile10)))
        .map((n) => ({
          mobile10: String(n.mobile10),
          app: (n.app === "staff" ? "staff" : "parent") as LoginApp,
          attempts: Math.max(1, Math.floor(Number(n.attempts) || 1)),
          firstAt: String(n.firstAt || n.lastAt || ""),
          lastAt: String(n.lastAt || n.firstAt || ""),
          doneAt: String(n.doneAt || ""),
          doneBy: String(n.doneBy || ""),
          note: String(n.note || ""),
        }))
    : [];
  return { version: 1, numbers };
}

/**
 * One more attempt from a number the ERP does not know. A number the office
 * marked done that tries again is reopened — whatever was done did not work.
 */
export function recordUnknownLogin(
  state: UnknownLoginState,
  mobile10: string,
  app: LoginApp,
  now: string,
): UnknownLoginState {
  if (!/^\d{10}$/.test(mobile10)) return state;
  const i = state.numbers.findIndex((n) => n.mobile10 === mobile10 && n.app === app);
  let numbers: UnknownLoginNumber[];
  if (i >= 0) {
    const cur = state.numbers[i];
    const next: UnknownLoginNumber = { ...cur, attempts: cur.attempts + 1, lastAt: now, doneAt: "", doneBy: "" };
    numbers = [next, ...state.numbers.slice(0, i), ...state.numbers.slice(i + 1)];
  } else {
    numbers = [{ mobile10, app, attempts: 1, firstAt: now, lastAt: now, doneAt: "", doneBy: "", note: "" }, ...state.numbers];
  }
  if (numbers.length > UNKNOWN_LOGIN_CAP) {
    // Drop handled ones first, oldest first; then the oldest open ones.
    const open = numbers.filter((n) => !n.doneAt);
    const done = numbers.filter((n) => n.doneAt).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    numbers = [...open, ...done].slice(0, UNKNOWN_LOGIN_CAP);
  }
  return { version: 1, numbers };
}

/** Mark done (with a note) or reopen. */
export function setUnknownLoginDone(
  state: UnknownLoginState,
  input: { mobile10: string; app: LoginApp; done: boolean; by: string; note: string; now: string },
): UnknownLoginState {
  return {
    version: 1,
    numbers: state.numbers.map((n) =>
      n.mobile10 === input.mobile10 && n.app === input.app
        ? input.done
          ? { ...n, doneAt: input.now, doneBy: input.by, note: input.note.trim() || n.note }
          : { ...n, doneAt: "", doneBy: "" }
        : n,
    ),
  };
}
