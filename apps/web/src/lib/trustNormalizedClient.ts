/**
 * Client → server sync for trust desk slices.
 */

import type { TrustState } from "@/lib/trust";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";
import {
  applySaveRevs,
  buildSaveRevs,
  captureRevBase,
  onSaveConflicts,
  type RevSlices,
} from "@/lib/sliceRevClient";

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
  }, DESK_PUSH_DEBOUNCE_MS);
}

/** The trust lists that carry per-row server versions (all of them). */
const TRUST_REV: RevSlices = {
  slices: [
    "projects",
    "workItems",
    "materials",
    "labourEntries",
    "allotments",
    "contractors",
    "workOrders",
    "raBills",
    "costLines",
    "rateCard",
  ],
};

/** After a load: the server's row versions, as this browser now holds the rows. */
export function captureTrustRevs(server: Record<string, unknown> | undefined, local: TrustState) {
  if (server) captureRevBase("trust", server, local as unknown as Record<string, unknown>, TRUST_REV);
}

async function pushTrustDeskApi(state: TrustState) {
  try {
    // Which rows this save changed, and from which server version: only
    // those are written, and only if nobody changed them first.
    const sentRevs = buildSaveRevs("trust", state as unknown as Record<string, unknown>, TRUST_REV);
    const res = await fetch("/api/school-data/trust-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...state, revs: sentRevs }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      projectCount?: number;
      error?: string;
      revs?: Record<string, Record<string, number>>;
      conflicts?: Record<string, string[]>;
    } | null;
    if (res.ok && body?.ok) {
      applySaveRevs("trust", state as unknown as Record<string, unknown>, sentRevs, body, TRUST_REV);
      onSaveConflicts("trust", "trust", body.conflicts);
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        projectCount: body.projectCount ?? state.projects.length,
      });
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("trust");
    else recordDeskSyncFailure("trust", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("trust", { status: 0, error: e instanceof Error ? e.message : String(e) });
    console.warn("[trust-db] desk push error", e);
  }
}

export async function hydrateTrustDeskFromDb(
  preferDb?: boolean,
): Promise<{
  bundle: Omit<TrustState, "version">;
  changed: boolean;
  /** false = fetch failed; bundle is NOT a confirmed empty state. */
  ok: boolean;
  /** What the server sent (rows with their `_rev`), even when not taken. */
  server?: Record<string, unknown>;
}> {
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
  if (!isSupabaseConfigured()) return { bundle: empty, changed: false, ok: false };
  try {
    const res = await fetch("/api/school-data/trust-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: empty, changed: false, ok: false };
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
    if (!shouldTake) return { bundle: empty, changed: false, ok: true, server: bundle };
    writeMeta({
      updatedAt: body.updatedAt || new Date().toISOString(),
      projectCount: remoteProjects,
    });
    return { bundle, changed: true, ok: true, server: bundle };
  } catch {
    return { bundle: empty, changed: false, ok: false };
  }
}
