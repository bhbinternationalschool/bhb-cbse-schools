/**
 * Browser side of the bus register / log book: the /api/v1 call shape
 * ({ok, data} | {ok:false, error:{message}}) and small formatting helpers.
 * No storage here — every figure comes from the server on each load.
 */

import type { RegisterDayMark } from "@/lib/transportBoardingLog";

export class RegisterCallError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "RegisterCallError";
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  type Body = { ok?: boolean; data?: T; error?: { message?: string } | string };
  let body: Body | null;
  try {
    body = (await res.json()) as Body;
  } catch {
    body = null;
  }
  if (!res.ok || !body || body.ok === false || body.data === undefined) {
    const msg = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new RegisterCallError(msg || `The server answered ${res.status}`, res.status);
  }
  return body.data;
}

export async function registerGet<T>(url: string): Promise<T> {
  return unwrap<T>(await fetch(url, { cache: "no-store" }));
}

export async function registerPost<T>(url: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** An id made on the phone, so a retried save cannot create a second row. */
export function clientId(prefix: string): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${raw.slice(0, 24)}`;
}

export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function timeIst(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** Shared control classes — tokens only, so both themes work. */
export const regField =
  "h-10 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm text-[var(--foreground)]";
export const regBtn =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50";
export const regBtnOutline =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50";

/**
 * One day's bus register marks across every bus the caller may see (undone
 * taps left out). Throws when the register could not be read — a caller must
 * never treat that as "nobody was marked".
 */
export async function fetchRegisterDayMarks(date: string): Promise<RegisterDayMark[]> {
  const v = await registerGet<{ marks?: RegisterDayMark[] }>(
    `/api/v1/transport/register/runs?date=${encodeURIComponent(date)}&marks=1`,
  );
  if (!Array.isArray(v.marks)) throw new RegisterCallError("The server did not return the marks", 502);
  return v.marks;
}
