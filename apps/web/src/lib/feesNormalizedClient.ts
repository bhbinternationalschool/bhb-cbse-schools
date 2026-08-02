/**
 * Client → server sync for normalized fee desk (vouchers + ancillary + open dues).
 */

import type { FeesState } from "@/lib/fees";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type { FeeDeskAncillary } from "@/lib/feesDeskAncillary.server";

const META_KEY = "bhb_fees_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: FeesState | null = null;

type DeskMeta = {
  updatedAt: string;
  voucherCount: number;
  ancillaryUpdatedAt?: string;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", voucherCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", voucherCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      voucherCount: Number(p.voucherCount) || 0,
      ancillaryUpdatedAt: p.ancillaryUpdatedAt,
    };
  } catch {
    return { updatedAt: "", voucherCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; voucherCount: number }) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(
    META_KEY,
    JSON.stringify({
      ...prev,
      ...patch,
    }),
  );
}

export function feesNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function feesReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FEES_READ_FROM_DB === "true";
}

/** @deprecated use scheduleFeesDeskSync */
export function scheduleFeesNormalizedSync(vouchers: FeesState["vouchers"]) {
  scheduleFeesDeskSync({
    version: 1,
    vouchers: vouchers ?? [],
    cheques: [],
    manualBooks: [],
    dayCloses: [],
    installmentPlans: [],
    planAllocations: [],
    carriedForwardDues: [],
    chargeVouchers: [],
  });
}

export function scheduleFeesDeskSync(state: FeesState) {
  if (!feesNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushFeesDeskApi(batch);
  }, 600);
}

async function pushFeesDeskApi(state: FeesState) {
  try {
    const res = await fetch("/api/school-data/fees-vouchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vouchers: state.vouchers ?? [],
        cheques: state.cheques ?? [],
        manualBooks: state.manualBooks ?? [],
        dayCloses: state.dayCloses ?? [],
        installmentPlans: state.installmentPlans ?? [],
        planAllocations: state.planAllocations ?? [],
        carriedForwardDues: state.carriedForwardDues ?? [],
        chargeVouchers: state.chargeVouchers ?? [],
        rebuildOpenDues: true,
        academicYearCode: state.vouchers[0]?.academicYearCode,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      count?: number;
      openDuesCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        voucherCount: body.count ?? state.vouchers.length,
        ancillaryUpdatedAt: body.updatedAt,
      });
    } else if (!res.ok) {
      console.warn("[fees-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[fees-db] desk push error", e);
  }
}

export async function fetchFeesDeskFromApi(): Promise<{
  vouchers: FeesState["vouchers"];
  ancillary: FeeDeskAncillary;
  updatedAt: string;
  count: number;
} | null> {
  if (!feesNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/fees-vouchers", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      vouchers?: FeesState["vouchers"];
      ancillary?: FeeDeskAncillary;
      updatedAt?: string;
      count?: number;
    };
    if (!Array.isArray(body.vouchers)) return null;
    return {
      vouchers: body.vouchers,
      ancillary: body.ancillary ?? {
        cheques: [],
        manualBooks: [],
        dayCloses: [],
        installmentPlans: [],
        planAllocations: [],
        carriedForwardDues: [],
        chargeVouchers: [],
      },
      updatedAt: body.updatedAt || "",
      count: body.count ?? body.vouchers.length,
    };
  } catch {
    return null;
  }
}

export async function hydrateFeesDeskFromDb(
  preferDb?: boolean,
): Promise<{
  vouchers: FeesState["vouchers"];
  ancillary: FeeDeskAncillary;
  changed: boolean;
}> {
  const remote = await fetchFeesDeskFromApi();
  if (!remote) {
    return {
      vouchers: [],
      ancillary: {
        cheques: [],
        manualBooks: [],
        dayCloses: [],
        installmentPlans: [],
        planAllocations: [],
        carriedForwardDues: [],
        chargeVouchers: [],
      },
      changed: false,
    };
  }

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    feesReadFromDbClientEnabled() ||
    meta.voucherCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.count > meta.voucherCount;

  if (!shouldTake) {
    return { vouchers: [], ancillary: remote.ancillary, changed: false };
  }

  writeMeta({
    updatedAt: remote.updatedAt,
    voucherCount: remote.count,
    ancillaryUpdatedAt: remote.updatedAt,
  });
  return {
    vouchers: remote.vouchers,
    ancillary: remote.ancillary,
    changed: true,
  };
}

/** @deprecated use hydrateFeesDeskFromDb */
export async function hydrateFeesVouchersFromDb(preferDb?: boolean) {
  const r = await hydrateFeesDeskFromDb(preferDb);
  return { vouchers: r.vouchers, changed: r.changed };
}
