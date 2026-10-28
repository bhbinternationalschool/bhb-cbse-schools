/**
 * The numbers a series has REALLY issued (data-layer 2.2c, director's review
 * 22 Oct 2026): a lagging counter hands out a number already in use, which is
 * worse than a big jump. For the series whose numbers live in a table we can
 * read, the highest one on record:
 *   ADMISSION → sis_students.admission_no, SRN → sis_students.srn,
 *   RECEIPT → fee_desk_vouchers.receipt_no.
 * A number counts when it is the series' prefix followed by digits only.
 */
import { fetchAllPages } from "@/lib/supabase/pageAll";
import type { RbacModule } from "@/lib/rbac";
import { getServerTenantContext } from "@/lib/serverTenant";

const ISSUED_IN: Readonly<Record<string, { table: string; column: string }>> = {
  ADMISSION: { table: "sis_students", column: "admission_no" },
  SRN: { table: "sis_students", column: "srn" },
  RECEIPT: { table: "fee_desk_vouchers", column: "receipt_no" },
};

export function seriesIssuedOnRecord(code: string): boolean {
  return code in ISSUED_IN;
}

/** lib/numberSeries resolveSeriesPrefix, server side (pure). */
export function seriesPrefix(series: Record<string, unknown>, ay: string | null): string {
  const base = String(series.prefix ?? "");
  if (series.includeSessionInPrefix !== true || !ay) return base;
  if (base.endsWith("/")) return `${base}${ay}/`;
  if (base.endsWith("-")) return `${base}${ay}-`;
  return `${base}-${ay}-`;
}

/** The numeric tail of `value` after `prefix`, or null. */
export function tailNumber(value: string, prefix: string): number | null {
  const v = value.trim();
  if (!v.startsWith(prefix)) return null;
  const tail = v.slice(prefix.length);
  if (!/^\d{1,12}$/.test(tail)) return null;
  const n = Number(tail);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** The highest number of this series on record (0 = none), or null when the series is not on record / the read failed. */
export async function maxIssuedNumber(code: string, prefix: string): Promise<{ ok: true; max: number } | { ok: false; error: string }> {
  const src = ISSUED_IN[code];
  if (!src) return { ok: false, error: `${code} is not issued into a table` };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const like = prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";
  const read = await fetchAllPages<Record<string, unknown>>((from, to) =>
    ctx.sb.from(src.table).select(src.column).eq("tenant_id", ctx.tenantId).like(src.column, like).range(from, to) as unknown as PromiseLike<{
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    }>,
  );
  if (read.error) return { ok: false, error: read.error };
  let max = 0;
  for (const r of read.rows) {
    const n = tailNumber(String(r[src.column] ?? ""), prefix);
    if (n !== null && n > max) max = n;
  }
  return { ok: true, max };
}

/** Which module issues each built-in series (lib/foundationMasters defaultNumberSeries). */
export const SERIES_ISSUER: Readonly<Record<string, readonly RbacModule[]>> = {
  ADMISSION: ["students", "admissions"],
  REGISTRATION: ["admissions", "students"],
  SRN: ["students", "admissions"],
  RECEIPT: ["fees"],
  TC: ["certificates"],
  CERT_BONAFIDE: ["certificates"],
  CERT_CHARACTER: ["certificates"],
  CERT_CLEARANCE: ["certificates"],
  CERT_FEES_PAID: ["certificates"],
  STAFF_AGREEMENT: ["staff"],
  STAFF_ID: ["staff"],
  EXPENSE_VOUCHER: ["accounts"],
};


/** The series' stored next number (per year when it resets per year and `ay` is given). */
export function nextOf(el: Record<string, unknown>, ay: string | null): number {
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const base = Number.isFinite(n(el.nextNumber)) ? Math.floor(n(el.nextNumber)) : 1;
  if (ay && el.resetOnAy === true) {
    const by = (el.countersByAy ?? {}) as Record<string, unknown>;
    const v = n(by[ay]);
    return Number.isFinite(v) ? Math.floor(v) : base;
  }
  return base;
}

