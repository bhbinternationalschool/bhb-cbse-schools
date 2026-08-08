/**
 * Server-side audit log — writes to Supabase audit_events when configured.
 */

import { createHash } from "crypto";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { DemoSession } from "@/lib/auth";

export type AuditInput = {
  session?: DemoSession | null;
  module: string;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

export type AuditResult = { ok: boolean; error?: string };

/**
 * Write one audit entry.
 *
 * Returns whether it was actually persisted rather than resolving void.
 * This previously warned and returned on failure, so a misconfigured
 * grant meant every audit write was silently discarded while callers
 * reported success — which is how `permission denied for table
 * audit_events` went unnoticed. Callers must surface a false result.
 */
export async function writeAudit(input: AuditInput): Promise<AuditResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    console.error(
      "[audit] NOT RECORDED — no tenant context:",
      input.module,
      input.action,
      input.summary || input.entityId,
    );
    return { ok: false, error: "No tenant context" };
  }
  const { sb, tenantId } = ctx;
  const row = {
    tenant_id: tenantId,
    actor_name: input.session?.fullName || "system",
    actor_email: input.session?.email || null,
    module: input.module,
    action: input.action,
    entity_type: input.entityType || "",
    entity_id: input.entityId || "",
    summary: input.summary || `${input.module}.${input.action}`,
    before_state: input.before ?? null,
    after_state: input.after ?? null,
    ip: input.ip || null,
    user_agent: input.userAgent || null,
  };
  const { error } = await sb.from("audit_events").insert(row);
  if (error) {
    console.error(
      "[audit] NOT RECORDED —",
      error.message,
      "|",
      input.module,
      input.action,
      input.summary || input.entityId,
    );
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
