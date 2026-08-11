/**
 * Browser → server audit recording.
 *
 * Student records are edited client-side (saveSis writes localStorage and
 * syncs a full roster snapshot later), so the server never sees "user X
 * changed student Y" — only a bulk push. That is why student changes have
 * never been audited. This records the intent at the point it happens.
 *
 * The actor is NOT sent from here: the API route resolves it from the
 * signed session cookie. A client cannot attribute an action to someone
 * else.
 */

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "status_change"
  | "merge"
  | "import"
  | "promote"
  | "export";

export type AuditRecordInput = {
  module: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
};

export { diffForAudit } from "@/lib/auditRedaction";

/** Fire-and-forget: auditing must never block or fail a user's save. */
export function recordAudit(input: AuditRecordInput): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/audit", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      keepalive: true,
    }).catch(() => {
      /* auditing is best-effort from the browser; server logs failures */
    });
  } catch {
    /* never surface to the user */
  }
}
