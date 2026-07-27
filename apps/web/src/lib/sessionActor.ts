/**
 * Client-side session actor for RBAC mutation checks.
 * SessionProvider registers the logged-in DemoSession; lib save* helpers read it.
 */

import type { SessionLike } from "@/lib/rbac";

let actor: SessionLike | null = null;

export function setSessionActor(session: SessionLike | null): void {
  actor = session
    ? {
        roleCode: session.roleCode || "",
        staffId: session.staffId,
        email: session.email,
        fullName: session.fullName || "",
        persona: session.persona,
      }
    : null;
}

export function getSessionActor(): SessionLike | null {
  return actor;
}

/** Clear actor (logout / unmount). */
export function clearSessionActor(): void {
  actor = null;
}
