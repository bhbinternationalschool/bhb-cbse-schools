/**
 * Shared Supabase jsonb blob sync (one row per tenant).
 * Used by fees / payments / attendance / exams Week 3–6 overlays.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBrowserSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { TENANT } from "@/lib/types";

export type DomainBlobTable =
  | "fees_state"
  | "payments_state"
  | "attendance_state"
  | "exams_state"
  | "payroll_state"
  | "accounts_state"
  | "store_state"
  | "purchase_state"
  | "staff_attendance_state"
  | "staff_hr_state"
  | "staff_advances_state"
  | "staff_agreements_state"
  | "rbac_state"
  | "module_registry_state"
  | "trust_state"
  | "transport_state"
  | "homework_state"
  | "timetable_state"
  | "exam_papers_state"
  | "ptm_state"
  | "student_leave_state"
  | "certificates_state"
  | "vault_state"
  | "rte_state"
  | "fee_recovery_tasks_state"
  | "school_comms_state"
  | "notifications_state"
  | "staff_chat_state"
  | "erp_chat_state"
  | "wa_templates_state"
  | "automation_state"
  | "admissions_state"
  | "library_state";

type BlobRow = {
  tenant_id: string;
  state: unknown;
  updated_at: string;
};

export type DomainBlobPersistence<T> = {
  remoteEnabled: () => boolean;
  scheduleSync: (state: T) => void;
  ensureHydrated: () => Promise<boolean>;
  resetCache: () => void;
};

export function createDomainBlobPersistence<T>(opts: {
  table: DomainBlobTable;
  /** localStorage key for last-known remote/local updated_at ISO */
  metaKey: string;
  label: string;
  isEmpty: (state: T) => boolean;
  /** Load + normalize from localStorage (existing load* helpers) */
  loadLocal: () => T;
  /**
   * Write state to localStorage without scheduling cloud sync
   * (hydrate path). May still update mirror if the domain uses it.
   */
  writeLocalRaw: (state: T) => void;
}): DomainBlobPersistence<T> {
  let tenantIdCache: string | null = null;
  let hydratedOnce = false;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPush: T | null = null;

  function remoteEnabled() {
    return isSupabaseConfigured();
  }

  function resetCache() {
    tenantIdCache = null;
    hydratedOnce = false;
    pendingPush = null;
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
  }

  function readMetaUpdatedAt(): string {
    if (typeof window === "undefined") return "";
    try {
      const raw = localStorage.getItem(opts.metaKey);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { updatedAt?: string };
      return String(parsed.updatedAt || "");
    } catch {
      return "";
    }
  }

  function writeMetaUpdatedAt(iso: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      opts.metaKey,
      JSON.stringify({ updatedAt: iso }),
    );
  }

  async function clientAndTenant(): Promise<{
    sb: SupabaseClient;
    tenantId: string;
  } | null> {
    const sb = createBrowserSupabase();
    if (!sb) return null;
    if (tenantIdCache) return { sb, tenantId: tenantIdCache };
    const { data, error } = await sb
      .from("tenants")
      .select("id")
      .eq("slug", TENANT.slug)
      .maybeSingle();
    if (error || !data?.id) {
      console.warn(`[${opts.label}] tenant resolve failed`, error?.message);
      return null;
    }
    tenantIdCache = data.id as string;
    return { sb, tenantId: tenantIdCache };
  }

  async function fetchRemote(): Promise<BlobRow | null> {
    if (!remoteEnabled()) return null;
    const ctx = await clientAndTenant();
    if (!ctx) return null;
    const { sb, tenantId } = ctx;
    const { data, error } = await sb
      .from(opts.table)
      .select("tenant_id, state, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      console.warn(`[${opts.label}] pull failed`, error.message);
      return null;
    }
    if (!data) return null;
    return data as BlobRow;
  }

  async function pushState(state: T): Promise<{ ok: boolean; error?: string }> {
    if (!remoteEnabled()) return { ok: true };
    const ctx = await clientAndTenant();
    if (!ctx) return { ok: false, error: "Tenant not resolved" };
    const { sb, tenantId } = ctx;
    const now = new Date().toISOString();
    const { error } = await sb.from(opts.table).upsert(
      {
        tenant_id: tenantId,
        state,
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    );
    if (error) {
      console.warn(`[${opts.label}] push failed`, error.message);
      return { ok: false, error: error.message };
    }
    writeMetaUpdatedAt(now);
    return { ok: true };
  }

  function scheduleSync(state: T) {
    if (!remoteEnabled()) return;
    if (typeof window === "undefined") return;
    writeMetaUpdatedAt(new Date().toISOString());
    pendingPush = state;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const payload = pendingPush;
      pendingPush = null;
      pushTimer = null;
      if (!payload) return;
      void pushState(payload);
    }, 500);
  }

  /**
   * Pull once per tab session. Remote wins when newer (or local empty).
   * Then push working copy so cloud stays warm.
   */
  async function ensureHydrated(): Promise<boolean> {
    if (!remoteEnabled()) return false;
    if (hydratedOnce) return false;
    hydratedOnce = true;

    const remote = await fetchRemote();
    const local = opts.loadLocal();
    const localAt = readMetaUpdatedAt();
    let changed = false;

    if (remote?.state && typeof remote.state === "object") {
      const remoteAt = remote.updated_at || "";
      const takeRemote =
        opts.isEmpty(local) ||
        !localAt ||
        (remoteAt && remoteAt >= localAt);
      if (takeRemote) {
        opts.writeLocalRaw(remote.state as T);
        writeMetaUpdatedAt(remoteAt || new Date().toISOString());
        changed = true;
      }
    }

    const next = opts.loadLocal();
    const remoteState =
      remote?.state && typeof remote.state === "object"
        ? (remote.state as T)
        : null;
    if (
      opts.isEmpty(next) &&
      remoteState &&
      !opts.isEmpty(remoteState)
    ) {
      opts.writeLocalRaw(remoteState);
      writeMetaUpdatedAt(remote?.updated_at || new Date().toISOString());
      return true;
    }
    if (!opts.isEmpty(next)) {
      await pushState(next);
    }
    return changed;
  }

  return {
    remoteEnabled,
    scheduleSync,
    ensureHydrated,
    resetCache,
  };
}
