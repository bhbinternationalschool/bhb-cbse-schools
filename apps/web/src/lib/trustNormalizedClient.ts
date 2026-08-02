/**
 * Client → server sync for trust desk slices.
 */

import type { TrustState } from "@/lib/trust";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_trust_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: TrustState | null = null;

type DeskMeta = { updatedAt: string; projectCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", projectCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", projectCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      projectCount: Number(p.projectCount) || 0,
    };
  } catch {
    return { updatedAt: "", projectCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

export function scheduleTrustDeskSync(state: TrustState) {
  if (!isSupabaseConfigured()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushTrustDeskApi(batch);
  }, 600);
}

async function pushTrustDeskApi(state: TrustState) {
  try {
    const res = await fetch("/api/school-data/trust-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      projectCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        projectCount: body.projectCount ?? state.projects.length,
      });
    }
  } catch (e) {
    console.warn("[trust-db] desk push error", e);
  }
}

export async function hydrateTrustDeskFromDb(
  preferDb?: boolean,
): Promise<{ bundle: Omit<TrustState, "version">; changed: boolean }> {
  const empty = {
    projects: [],
    workItems: [],
    materials: [],
    labourEntries: [],
    allotments: [],
    contractors: [],
    workOrders: [],
    raBills: [],
    costLines: [],
    rateCard: [],
  };
  if (!isSupabaseConfigured()) return { bundle: empty, changed: false };
  try {
    const res = await fetch("/api/school-data/trust-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: empty, changed: false };
    const body = (await res.json()) as Omit<TrustState, "version"> & {
      updatedAt?: string;
      projectCount?: number;
    };
    const bundle = {
      projects: Array.isArray(body.projects) ? body.projects : [],
      workItems: Array.isArray(body.workItems) ? body.workItems : [],
      materials: Array.isArray(body.materials) ? body.materials : [],
      labourEntries: Array.isArray(body.labourEntries) ? body.labourEntries : [],
      allotments: Array.isArray(body.allotments) ? body.allotments : [],
      contractors: Array.isArray(body.contractors) ? body.contractors : [],
      workOrders: Array.isArray(body.workOrders) ? body.workOrders : [],
      raBills: Array.isArray(body.raBills) ? body.raBills : [],
      costLines: Array.isArray(body.costLines) ? body.costLines : [],
      rateCard: Array.isArray(body.rateCard) ? body.rateCard : [],
    };
    const meta = readMeta();
    const remoteProjects = body.projectCount ?? bundle.projects.length;
    const shouldTake =
      preferDb ||
      process.env.NEXT_PUBLIC_TRUST_READ_FROM_DB === "true" ||
      meta.projectCount === 0 ||
      (body.updatedAt && body.updatedAt >= meta.updatedAt) ||
      remoteProjects > meta.projectCount;
    if (!shouldTake) return { bundle: empty, changed: false };
    writeMeta({
      updatedAt: body.updatedAt || new Date().toISOString(),
      projectCount: remoteProjects,
    });
    return { bundle, changed: true };
  } catch {
    return { bundle: empty, changed: false };
  }
}
