"use client";

import { createContext, useContext, useEffect } from "react";
import type { DemoSession } from "@/lib/auth";
import { clearSessionActor, setSessionActor } from "@/lib/sessionActor";

export type SessionWorkspace = {
  session: DemoSession;
  /** True when the header-selected academic year is closed. */
  readOnly: boolean;
};

const SessionContext = createContext<SessionWorkspace | null>(null);

export function SessionProvider({
  session,
  readOnly = false,
  children,
}: {
  session: DemoSession;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  // Sync actor during render so save* helpers see RBAC before effects run
  setSessionActor(session);

  useEffect(() => {
    setSessionActor(session);
    return () => clearSessionActor();
  }, [session]);

  return (
    <SessionContext.Provider value={{ session, readOnly }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useDemoSession(): DemoSession {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useDemoSession must be used within SessionProvider");
  }
  return ctx.session;
}

export function useDemoSessionOptional(): DemoSession | null {
  return useContext(SessionContext)?.session ?? null;
}

/** Header session plus whether the selected year is closed (read-only). */
export function useSessionWorkspace(): SessionWorkspace {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSessionWorkspace must be used within SessionProvider");
  }
  return ctx;
}

export function useSessionReadOnly(): boolean {
  return useContext(SessionContext)?.readOnly ?? false;
}
