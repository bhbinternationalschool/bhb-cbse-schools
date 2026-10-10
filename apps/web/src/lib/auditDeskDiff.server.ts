/**
 * Audit for desk-slice sync routes.
 *
 * Desk routes push a *full snapshot* of an array (e.g. every fee voucher)
 * on every save — there is no "user X edited record Y" event to hang an
 * audit write on, which is exactly why money modules ended up with zero
 * audit coverage while students (which calls recordAudit per-edit from the
 * client) has some. This diffs the incoming snapshot against what was
 * already in the DB and writes one audit_events row per record that
 * actually changed, so a bulk resync of unchanged data stays silent.
 */

import type { DemoSession } from "@/lib/auth";
import { diffForAudit } from "@/lib/auditRedaction";
import { writeAudit } from "@/lib/audit.server";

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * A timestamp round-tripped through a Postgres timestamptz column comes
 * back as e.g. "2026-08-10T12:00:00+00:00" even when the client originally
 * sent "2026-08-10T12:00:00.000Z" — the same instant, a different string.
 * diffForAudit does a strict JSON compare, so every synced record with a
 * datetime field would otherwise show up as "changed" on every resync,
 * forever. Canonicalize ISO-date-shaped strings before comparing so only
 * genuine content changes get audited.
 */
function normalizeForCompare<T>(value: T): T {
  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) {
      const t = Date.parse(value);
      if (!Number.isNaN(t)) return new Date(t).toISOString() as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeForCompare(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeForCompare(v);
    }
    return out as T;
  }
  return value;
}

/** Auditing must never fail the request it's attached to — a sync route's
 * job is the sync; log and move on if the audit write itself fails. */
async function writeAuditBestEffort(
  input: Parameters<typeof writeAudit>[0],
): Promise<void> {
  try {
    const result = await writeAudit(input);
    if (!result.ok) {
      console.error(
        "[auditDeskDiff] write failed:",
        input.module,
        input.action,
        input.entityId,
        result.error,
      );
    }
  } catch (e) {
    console.error("[auditDeskDiff] write threw:", input.module, input.entityId, e);
  }
}

export async function auditArrayDiff<T extends { id: string }>(opts: {
  session: DemoSession | null | undefined;
  module: string;
  entityType: string;
  before: T[];
  after: T[];
  ip?: string | null;
  userAgent?: string | null;
  summarize?: (record: T, action: "create" | "update" | "delete") => string;
}): Promise<void> {
  const beforeMap = new Map(opts.before.map((r) => [r.id, r]));
  const afterMap = new Map(opts.after.map((r) => [r.id, r]));
  const writes: Promise<void>[] = [];

  for (const [id, rec] of afterMap) {
    const prev = beforeMap.get(id);
    if (!prev) {
      writes.push(
        writeAuditBestEffort({
          session: opts.session,
          module: opts.module,
          action: "create",
          entityType: opts.entityType,
          entityId: id,
          summary: opts.summarize?.(rec, "create"),
          after: rec,
          ip: opts.ip,
          userAgent: opts.userAgent,
        }),
      );
      continue;
    }
    const diff = diffForAudit(
      normalizeForCompare(prev) as unknown as Record<string, unknown>,
      normalizeForCompare(rec) as unknown as Record<string, unknown>,
    );
    if (diff.changedFields.length === 0) continue;
    writes.push(
      writeAuditBestEffort({
        session: opts.session,
        module: opts.module,
        action: "update",
        entityType: opts.entityType,
        entityId: id,
        summary:
          opts.summarize?.(rec, "update") ??
          `${opts.entityType} updated: ${diff.changedFields.join(", ")}`,
        before: diff.before,
        after: diff.after,
        ip: opts.ip,
        userAgent: opts.userAgent,
      }),
    );
  }

  for (const [id, rec] of beforeMap) {
    if (afterMap.has(id)) continue;
    writes.push(
      writeAuditBestEffort({
        session: opts.session,
        module: opts.module,
        action: "delete",
        entityType: opts.entityType,
        entityId: id,
        summary: opts.summarize?.(rec, "delete"),
        before: rec,
        ip: opts.ip,
        userAgent: opts.userAgent,
      }),
    );
  }

  await Promise.all(writes);
}
