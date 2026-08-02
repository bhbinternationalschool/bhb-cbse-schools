/**
 * Client → server sync for normalized payment desk ledger.
 */

import type { PaymentsState } from "@/lib/payments";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_payments_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: PaymentsState | null = null;

type DeskMeta = {
  updatedAt: string;
  linkCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", linkCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", linkCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      linkCount: Number(p.linkCount) || 0,
    };
  } catch {
    return { updatedAt: "", linkCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; linkCount: number }) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function paymentsNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function paymentsReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PAYMENTS_READ_FROM_DB === "true";
}

export function schedulePaymentsDeskSync(state: PaymentsState) {
  if (!paymentsNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushPaymentsDeskApi(batch);
  }, 600);
}

async function pushPaymentsDeskApi(state: PaymentsState) {
  try {
    const res = await fetch("/api/school-data/payment-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ links: state.links ?? [] }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      count?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        linkCount: body.count ?? state.links.length,
      });
    } else if (!res.ok) {
      console.warn("[payments-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[payments-db] desk push error", e);
  }
}

export async function fetchPaymentsDeskFromApi(): Promise<{
  links: PaymentsState["links"];
  updatedAt: string;
  count: number;
} | null> {
  if (!paymentsNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/payment-links", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      links?: PaymentsState["links"];
      updatedAt?: string;
      count?: number;
    };
    if (!Array.isArray(body.links)) return null;
    return {
      links: body.links,
      updatedAt: body.updatedAt || "",
      count: body.count ?? body.links.length,
    };
  } catch {
    return null;
  }
}

export async function hydratePaymentsDeskFromDb(
  preferDb?: boolean,
): Promise<{ links: PaymentsState["links"]; changed: boolean }> {
  const remote = await fetchPaymentsDeskFromApi();
  if (!remote) return { links: [], changed: false };

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    paymentsReadFromDbClientEnabled() ||
    meta.linkCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.count > meta.linkCount;

  if (!shouldTake) return { links: [], changed: false };

  writeMeta({
    updatedAt: remote.updatedAt,
    linkCount: remote.count,
  });
  return { links: remote.links, changed: true };
}
