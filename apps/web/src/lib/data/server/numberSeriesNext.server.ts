/**
 * The next number to ISSUE from a Masters number series, never one already on
 * record (data-layer 2.2c's POST /api/data/masters.number-series/next, moved
 * here in 2.2e so the mobile fee counter's route uses the same rule):
 *
 *   next = max(the series' stored next, the highest number on record + 1)
 *
 * (ADMISSION / SRN in sis_students, RECEIPT in fee_desk_vouchers —
 * numberSeriesIssued). A counter found behind its records is LIFTED
 * (masters_series_bump, monotone) and the lift is logged.
 *
 * RECEIPT and SRN are RESERVED, not peeked (masters_series_claim, migration
 * 20261027090000): the database computes the same max under the series lock
 * and moves the counter past the number in the same transaction, so two
 * counters asking at the same instant get two numbers. A claimed number that
 * is then not saved leaves a gap — never a repeat. ADMISSION (the student
 * form's suggestion, asked when the form opens) keeps the peek + lift below.
 *
 * `authorize(code)` runs after the series is read and before anything moves;
 * a string it returns is the refusal (403).
 */
import "server-only";
import { invalidateServerMastersCache } from "@/lib/api/v1/auth";
import { clearDeskProbeCache } from "@/lib/deskProbeCache.server";
import { maxIssuedNumber, nextOf, seriesIssuedOnRecord, seriesPrefix, tailNumber } from "./numberSeriesIssued";
import { bumpNumberSeries, claimNumberSeries, readNumberSeries } from "./repo";

/** The series issued at save time, whose numbers are reserved in the database. */
export const CLAIMED_SERIES: ReadonlySet<string> = new Set(["RECEIPT", "SRN"]);

export type SeriesNextAnswer =
  | { ok: true; series: string; next: number; formatted: string; lifted: boolean }
  | { ok: false; status: 400 | 403 | 404 | 503; kind: "invalid" | "auth" | "not_found" | "unavailable"; message: string };

export async function nextSeriesNumberServer(
  series: string,
  ay: string | null,
  authorize: (code: string) => string | null = () => null,
): Promise<SeriesNextAnswer> {
  let stored: Record<string, unknown> | null;
  try {
    stored = await readNumberSeries(series);
  } catch (e) {
    return { ok: false, status: 503, kind: "unavailable", message: `Could not read the number series (${e instanceof Error ? e.message : String(e)}).` };
  }
  if (!stored) return { ok: false, status: 404, kind: "not_found", message: `No number series ${series} in Masters.` };
  const code = String(stored.code ?? "");
  const refusal = authorize(code);
  if (refusal) return { ok: false, status: 403, kind: "auth", message: refusal };

  if (CLAIMED_SERIES.has(code)) {
    const claimed = await claimNumberSeries(code, ay);
    if (!claimed.ok) {
      return { ok: false, status: claimed.status, kind: claimed.kind === "auth" ? "auth" : claimed.kind, message: claimed.message };
    }
    if (claimed.lifted) console.warn(`[number-series] ${code}: counter was behind the records — claimed ${claimed.formatted}`);
    clearDeskProbeCache("masters-desk-rows");
    invalidateServerMastersCache();
    return { ok: true, series: code, next: claimed.number, formatted: claimed.formatted, lifted: claimed.lifted };
  }

  const current = nextOf(stored, ay);
  const prefix = seriesPrefix(stored, ay);
  let next = current;
  let lifted = false;
  if (seriesIssuedOnRecord(code)) {
    const issued = await maxIssuedNumber(code, prefix);
    // Unknown is not "none": without the records the number may be in use.
    if (!issued.ok) {
      return { ok: false, status: 503, kind: "unavailable", message: `Could not read the ${code} numbers on record — not offering one (${issued.error}).` };
    }
    if (issued.max + 1 > current) {
      console.warn(`[number-series] ${code}: counter ${current} behind the records (${prefix}${issued.max}) — lifting to ${issued.max + 1}`);
      const out = await bumpNumberSeries(code || series, issued.max, ay);
      if (!out.ok) return { ok: false, status: out.status === 400 ? 400 : out.status === 404 ? 404 : 503, kind: out.kind === "auth" ? "auth" : out.kind, message: out.message };
      next = issued.max + 1;
      lifted = true;
      clearDeskProbeCache("masters-desk-rows");
      invalidateServerMastersCache();
    }
  }
  const pad = Number(stored.padWidth) > 0 ? Math.floor(Number(stored.padWidth)) : 0;
  return { ok: true, series: code, next, formatted: `${prefix}${String(next).padStart(pad, "0")}`, lifted };
}

/**
 * After a number was issued on the server (the mobile fee counter's receipt):
 * move the series past it (masters_series_bump, monotone). The browser does
 * this through POST …/bump (lib/numberSeries persistSeriesUse), which is a
 * no-op on the server — so until 2.2e receipts issued by a server route never
 * moved the counter, and it fell behind the records. Never throws; a failure
 * is logged (the next /next answer lifts the counter from the records anyway).
 */
export async function recordSeriesUseServer(code: string, ay: string | null, formatted: string): Promise<boolean> {
  try {
    const stored = await readNumberSeries(code);
    if (!stored) return false;
    const yearKey = stored.resetOnAy === true ? ay : null;
    const used = tailNumber(formatted, seriesPrefix(stored, ay));
    if (used === null || used + 1 <= nextOf(stored, yearKey)) return false;
    const out = await bumpNumberSeries(String(stored.code ?? code), used, yearKey);
    if (!out.ok) {
      console.warn(`[number-series] ${code}: not moved past ${formatted} (${out.message})`);
      return false;
    }
    clearDeskProbeCache("masters-desk-rows");
    invalidateServerMastersCache();
    return true;
  } catch (e) {
    console.warn(`[number-series] ${code}: not moved past ${formatted} (${e instanceof Error ? e.message : String(e)})`);
    return false;
  }
}
