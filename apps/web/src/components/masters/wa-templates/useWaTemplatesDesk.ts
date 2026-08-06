"use client";

import { useCallback, useEffect, useState } from "react";
import { ensureWaTemplatesHydrated } from "@/lib/waTemplatesPersistence";
import {
  loadWaTemplates,
  saveWaTemplates,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import {
  useDemoSession,
  useSessionReadOnly,
} from "@/components/shell/SessionContext";

export function useWaTemplatesDesk() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [state, setState] = useState<WaTemplatesState | null>(() =>
    typeof window !== "undefined" ? loadWaTemplates() : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(() => {
    setState(loadWaTemplates());
  }, []);

  useEffect(() => {
    refresh();
    void (async () => {
      await ensureWaTemplatesHydrated();
      refresh();
    })();
  }, [refresh]);

  function flash(msg: string, ms = 2800) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), ms);
  }

  function commit(next: WaTemplatesState, msg?: string) {
    if (readOnly) {
      flash("Session is closed — templates are read-only");
      return false;
    }
    setState(next);
    saveWaTemplates(next);
    if (msg) flash(msg);
    return true;
  }

  async function syncMeta() {
    if (!state) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/wa/templates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        state?: WaTemplatesState;
        mode?: string;
        synced?: number;
      };
      if (json.state) {
        commit(
          json.state,
          json.ok
            ? `Synced ${json.synced ?? 0} templates (${json.mode})`
            : json.error || "Sync finished with warnings",
        );
      } else {
        flash(json.error || "Sync failed", 3200);
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : "Sync failed", 3200);
    } finally {
      setSyncing(false);
    }
  }

  async function submitMeta(
    templateId: string,
    stateOverride?: WaTemplatesState,
  ): Promise<boolean> {
    const base = stateOverride || state;
    if (!base) return false;
    setSubmitting(true);
    try {
      const res = await fetch("/api/wa/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, state: base }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        state?: WaTemplatesState;
        status?: string;
        warnings?: string[];
      };
      if (json.state) {
        commit(
          json.state,
          json.ok
            ? `Submitted to Meta (${json.status || "PENDING"})`
            : json.error || "Submit failed",
        );
      }
      if (json.warnings?.length) flash(json.warnings.join(" "), 5000);
      if (!res.ok && !json.state) {
        flash(json.error || "Submit failed", 4000);
        return false;
      }
      return !!json.ok;
    } catch (e) {
      flash(e instanceof Error ? e.message : "Submit failed", 3200);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  return {
    session,
    readOnly,
    state,
    notice,
    syncing,
    submitting,
    commit,
    syncMeta,
    submitMeta,
    flash,
    refresh,
  };
}
