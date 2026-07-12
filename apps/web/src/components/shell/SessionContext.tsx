"use client";

import { createContext, useContext } from "react";
import type { DemoSession } from "@/lib/auth";

const SessionContext = createContext<DemoSession | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: DemoSession;
  children: React.ReactNode;
}) {
  return (
    <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
  );
}

export function useDemoSession(): DemoSession {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useDemoSession must be used within SessionProvider");
  }
  return session;
}

export function useDemoSessionOptional(): DemoSession | null {
  return useContext(SessionContext);
}
