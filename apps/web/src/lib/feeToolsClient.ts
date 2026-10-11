/**
 * Browser side of Fees → Bulk & PDC: tiny fetch helpers and the shapes the
 * /api/fees/tools/* routes answer with. No storage — every screen reads the
 * server and shows "could not load" when it cannot.
 */

import type { BulkDue } from "@/lib/feeBulkAllocation";

export type LookupStudent = {
  id: string;
  name: string;
  admissionNo: string;
  classLabel: string;
  householdId: string;
  guardianName: string;
  siblingIds: string[];
  dues?: BulkDue[];
};

export type ToolsResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function readJson<T>(res: Response): Promise<ToolsResult<T>> {
  const j = (await res.json().catch(() => null)) as (ToolsResult<T> & { error?: unknown }) | null;
  if (!j) return { ok: false, error: `The server did not answer properly (HTTP ${res.status})` };
  if (!res.ok || j.ok !== true) {
    const err = typeof j.error === "string" ? j.error : `Request failed (HTTP ${res.status})`;
    return { ok: false, error: err };
  }
  return j;
}

export async function toolsGet<T>(url: string): Promise<ToolsResult<T>> {
  try {
    return await readJson<T>(await fetch(url, { credentials: "same-origin", cache: "no-store" }));
  } catch {
    return { ok: false, error: "Could not reach the server — check the connection" };
  }
}

export async function toolsPost<T>(url: string, body: unknown): Promise<ToolsResult<T>> {
  try {
    return await readJson<T>(
      await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return { ok: false, error: "Could not reach the server — nothing may have been saved; reload and check" };
  }
}

export function inr(paise: number): string {
  return `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "1,500.50" → 150050 paise; null for anything that is not a plain amount. */
export function rupeesToPaise(text: string): number | null {
  const t = text.replace(/[,₹\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function paiseToRupeesText(paise: number): string {
  const r = Math.round(paise) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

export function istTodayClient(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** A batch id for one bulk payment — minted once per preview, reused on retry. */
export function newBatchId(): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(10)))
    .map((b) => (b % 36).toString(36))
    .join("");
  return `bulk_${rand}`;
}
