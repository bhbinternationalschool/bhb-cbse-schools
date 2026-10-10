/**
 * Shared audit-diff + redaction logic — isomorphic (no `window`/`fetch`),
 * usable from both the browser (auditClient.ts) and server routes writing
 * directly via audit.server.ts's writeAudit(). writeAudit() itself does
 * NOT redact; every caller must run its before/after through diffForAudit
 * first, exactly like the client path already does.
 */

/**
 * Fields never written to the audit trail. An audit log is a second copy
 * of the data, so full identity numbers and credentials must not be
 * duplicated into it — the changed-field list is what matters, not the
 * secret itself.
 */
export const REDACTED_FIELDS = new Set([
  "aadhaarNumber",
  "fatherAadhaarNumber",
  "motherAadhaarNumber",
  "loginPassword",
  "bankAccountNo",
]);

export const REDACTED = "[redacted]";

/**
 * Build a minimal before/after for an update: only fields that actually
 * changed, with sensitive values redacted. Keeps the trail useful without
 * copying an entire record on every save.
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
