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

/**
 * Fields never written to the audit trail. An audit log is a second copy
 * of the data, so full identity numbers and credentials must not be
 * duplicated into it — the changed-field list is what matters, not the
 * secret itself.
 */
const REDACTED_FIELDS = new Set([
  "aadhaarNumber",
  "fatherAadhaarNumber",
  "motherAadhaarNumber",
  "loginPassword",
  "bankAccountNo",
]);

const REDACTED = "[redacted]";

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

/**
 * Build a minimal before/after for an update: only fields that actually
 * changed, with sensitive values redacted. Keeps the trail useful without
 * copying an entire student record on every keystroke-level save.
 */
export function diffForAudit<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T,
): {
  changedFields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} {
  const changed: string[] = [];
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  if (!before) {
    return { changedFields: [], before: {}, after: {} };
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const bv = before[k];
    const av = after[k];
    // Cheap deep-ish compare: these are plain JSON-shaped values.
    if (JSON.stringify(bv) === JSON.stringify(av)) continue;
    changed.push(k);
    if (REDACTED_FIELDS.has(k)) {
      b[k] = bv ? REDACTED : "";
      a[k] = av ? REDACTED : "";
    } else {
      b[k] = bv ?? null;
      a[k] = av ?? null;
    }
  }
  return { changedFields: changed, before: b, after: a };
}
