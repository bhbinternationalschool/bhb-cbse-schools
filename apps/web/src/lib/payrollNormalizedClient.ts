/**
 * Client → server sync for normalized payroll desk.
 */

import type { PayrollState } from "@/lib/payroll";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";

const META_KEY = "bhb_payroll_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: PayrollState | null = null;

type DeskMeta = { updatedAt: string; runCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", runCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", runCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      runCount: Number(p.runCount) || 0,
    };
  } catch {
    return { updatedAt: "", runCount: 0 };
  }
}

function writeMeta(
  patch: Partial<DeskMeta> & { updatedAt: string; runCount: number },
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

export function payrollNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function payrollReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PAYROLL_READ_FROM_DB === "true";
}

export function schedulePayrollDeskSync(state: PayrollState) {
  if (!payrollNormalizedSyncEnabled() || typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (batch) void pushPayrollDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushPayrollDeskApi(state: PayrollState) {
  try {
    const res = await fetch("/api/school-data/payroll-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runs: state.runs, audit: state.audit }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      runCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        runCount: body.runCount ?? state.runs.length,
      });
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("payroll");
    else recordDeskSyncFailure("payroll", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("payroll", { status: 0, error: e instanceof Error ? e.message : String(e) });
    console.warn("[payroll-db] desk push error", e);
  }
}

export async function fetchPayrollDeskFromApi() {
  if (!payrollNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/payroll-desk", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as PayrollState & {
      ok?: boolean;
      updatedAt?: string;
      runCount?: number;
    };
    if (!Array.isArray(body.runs)) return null;
    return {
      bundle: {
        runs: body.runs,
        audit: body.audit ?? [],
      },
      updatedAt: body.updatedAt || "",
      runCount: body.runCount ?? body.runs.length,
    };
  } catch {
    return null;
  }
}

export async function hydratePayrollDeskFromDb(preferDb?: boolean) {
  const remote = await fetchPayrollDeskFromApi();
  const empty = {
    bundle: { runs: [] as PayrollState["runs"], audit: [] as PayrollState["audit"] },
    changed: false,
    ok: false,
  };
  if (!remote) return empty;

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    payrollReadFromDbClientEnabled() ||
    meta.runCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.runCount > meta.runCount;

  if (!shouldTake) return { ...empty, bundle: remote.bundle, ok: true };

  writeMeta({ updatedAt: remote.updatedAt, runCount: remote.runCount });
  return { bundle: remote.bundle, changed: true, ok: true };
}
