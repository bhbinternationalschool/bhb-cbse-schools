"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadWaChatbotFlows,
  saveWaChatbotFlows,
  type WaChatbotFlowsState,
} from "@/lib/waChatbotFlows";
import { ensureWaChatbotFlowsHydrated } from "@/lib/waChatbotPersistence";
import {
  useDemoSession,
  useSessionReadOnly,
} from "@/components/shell/SessionContext";

export function useWaChatbotDesk() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [state, setState] = useState<WaChatbotFlowsState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setState(loadWaChatbotFlows());
  }, []);

  useEffect(() => {
    refresh();
    void ensureWaChatbotFlowsHydrated().then(refresh);
  }, [refresh]);

  function flash(msg: string, ms = 2800) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), ms);
  }

  function commit(next: WaChatbotFlowsState, msg?: string) {
    if (readOnly) {
      flash("Session is closed — chatbots are read-only");
      return false;
    }
    setState(next);
    saveWaChatbotFlows(next);
    if (msg) flash(msg);
    return true;
  }

  return {
    session,
    readOnly,
    state,
    notice,
    commit,
    flash,
    refresh,
  };
}
