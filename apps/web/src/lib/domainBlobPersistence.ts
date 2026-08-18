/**
 * Shared jsonb blob sync (one row per tenant), routed through the
 * server-side /api/school-data/domain-blob endpoint — the browser never
 * talks to Supabase directly for these tables (keeps RBAC enforcement
 * server-side rather than relying on RLS for authorization).
 */

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import { scheduleRetryingPush } from "@/lib/syncRetryStatus";

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
  | "teaching_state"
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
  let hydratedOnce = false;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPush: T | null = null;

  function remoteEnabled() {
    return isSupabaseConfigured();
  }

  function resetCache() {
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

  async function fetchRemote(): Promise<BlobRow | null> {
    if (!remoteEnabled()) return null;
    if (typeof window === "undefined") return null;
    try {
      const res = await fetch(
        `/api/school-data/domain-blob?table=${encodeURIComponent(opts.table)}`,
        { method: "GET", credentials: "same-origin", cache: "no-store" },
      );
      if (!res.ok) {
        console.warn(`[${opts.label}] pull failed`, res.status);
        return null;
      }
      const body = (await res.json()) as {
        ok?: boolean;
        state?: unknown;
        updatedAt?: string;
      };
      if (!body.ok) return null;
      return { state: body.state ?? null, updated_at: body.updatedAt || "" };
    } catch (e) {
      console.warn(`[${opts.label}] pull error`, e);
      return null;
    }
  }

  async function pushState(state: T): Promise<{ ok: boolean; error?: string }> {
    if (!remoteEnabled()) return { ok: true };
    if (typeof window === "undefined") return { ok: true };
    try {
      const res = await fetch("/api/school-data/domain-blob", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: opts.table, state }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        updatedAt?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        const message = body?.error || `HTTP ${res.status}`;
        console.warn(`[${opts.label}] push failed`, message);
        return { ok: false, error: message };
      }
      writeMetaUpdatedAt(body.updatedAt || new Date().toISOString());
      return { ok: true };
    } catch (e) {
      console.warn(`[${opts.label}] push error`, e);
      return { ok: false, error: String(e) };
    }
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
      scheduleRetryingPush(`blob:${opts.table}`, () => pushState(payload));
    }, DESK_PUSH_DEBOUNCE_MS);
  }

  /**
   * Pull once per tab session. Remote wins when newer (or local empty).
   *
   * Pull-only. This used to end by pushing the local working copy "so the
   * cloud stays warm" — including when fetchRemote() had failed, so a
   * browser that could not read the server overwrote it with whatever it
   * held. Multiplied across ~30 modules that is the login-time write storm
   * seen in Cloud Run (audit 2026-08-18). Local edits reach the DB through
   * scheduleSync() from an explicit save only.
   */
  async function ensureHydrated(): Promise<boolean> {
    if (!remoteEnabled()) return false;
    if (hydratedOnce) return false;
    hydratedOnce = true;

    const remote = await fetchRemote();
    if (!remote) {
      // Unknown is not empty: leave local alone, and let a later call retry.
      hydratedOnce = false;
      return false;
    }
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
    return changed;
  }

  return {
    remoteEnabled,
    scheduleSync,
    ensureHydrated,
    resetCache,
  };
}
