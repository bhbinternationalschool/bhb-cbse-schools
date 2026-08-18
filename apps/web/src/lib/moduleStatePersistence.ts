/**
 * Client factory for the generic module_local_state store: pull once per
 * hydrate window, push on explicit save (retry ladder + status), never push
 * from hydration, and never take an empty local copy over a configured
 * server copy. Mirrors domainBlobPersistence but hits
 * /api/school-data/module-state/<key>.
 */

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { scheduleRetryingPush } from "@/lib/syncRetryStatus";
import { isDeskHydrated, markDeskHydrated, resetDeskHydrated } from "@/lib/deskHydrateGuard";
import { MODULE_STATE_DEFS, type ModuleStateKey } from "@/lib/moduleStateRegistry";

export const MODULE_STATE_UPDATED_EVENT = "bhb-module-state-updated";

export type ModuleStatePersistence<T> = {
  scheduleSync: (state: T) => void;
  ensureHydrated: () => Promise<boolean>;
  resetCache: () => void;
};

export function createModuleStatePersistence<T extends object>(opts: {
  key: ModuleStateKey;
  /** true when the state holds nothing worth defending (defaults / empty). */
  isEmpty: (state: T) => boolean;
  loadLocal: () => T;
  /** Write local cache without RBAC checks and without scheduling a push. */
  writeLocalRaw: (state: T) => void;
}): ModuleStatePersistence<T> {
  const metaKey = `bhb_module_state_meta_v1:${opts.key}`;
  const label = MODULE_STATE_DEFS[opts.key].label;
  const guardKey = `module_state:${opts.key}`;
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function readMetaAt(): string {
    try {
      const raw = localStorage.getItem(metaKey);
      return raw ? String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "") : "";
    } catch {
      return "";
    }
  }
  function writeMetaAt(iso: string) {
    try {
      localStorage.setItem(metaKey, JSON.stringify({ updatedAt: iso }));
    } catch {
      /* ignore */
    }
  }

  async function push(state: T): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/school-data/module-state/${opts.key}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; updatedAt?: string; error?: string } | null;
      if (!res.ok || !body?.ok) {
        const message = body?.error || `HTTP ${res.status}`;
        console.warn(`[${label}] push failed`, message);
        return { ok: false, error: message };
      }
      writeMetaAt(body.updatedAt || new Date().toISOString());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function scheduleSync(state: T) {
    if (typeof window === "undefined" || !isSupabaseConfigured()) return;
    pending = state;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const payload = pending;
      pending = null;
      timer = null;
      if (!payload) return;
      scheduleRetryingPush(guardKey, () => push(payload));
    }, 0);
  }

  async function ensureHydrated(): Promise<boolean> {
    if (typeof window === "undefined" || !isSupabaseConfigured()) return false;
    if (isDeskHydrated(guardKey)) return false;
    let remote: { state: T | null; updatedAt: string } | null = null;
    try {
      const res = await fetch(`/api/school-data/module-state/${opts.key}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) return false; // unknown ≠ empty; retry next time
      const body = (await res.json()) as { ok?: boolean; state?: T | null; updatedAt?: string };
      if (!body.ok) return false;
      remote = { state: body.state ?? null, updatedAt: body.updatedAt || "" };
    } catch {
      return false;
    }
    markDeskHydrated(guardKey);
    if (!remote.state || typeof remote.state !== "object") return false;

    const local = opts.loadLocal();
    const localAt = readMetaAt();
    const takeRemote =
      opts.isEmpty(local) || !localAt || (remote.updatedAt && remote.updatedAt >= localAt);
    if (!takeRemote) return false;
    opts.writeLocalRaw(remote.state);
    writeMetaAt(remote.updatedAt || new Date().toISOString());
    window.dispatchEvent(new CustomEvent(MODULE_STATE_UPDATED_EVENT, { detail: { key: opts.key } }));
    return true;
  }

  return {
    scheduleSync,
    ensureHydrated,
    resetCache: () => {
      resetDeskHydrated(guardKey);
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
