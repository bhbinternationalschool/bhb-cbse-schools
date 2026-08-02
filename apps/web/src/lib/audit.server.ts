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

export async function writeAudit(input: AuditInput): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    console.info("[audit]", input.module, input.action, input.summary || input.entityId);
    return;
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
    console.warn("[audit] insert failed", error.message);
  }
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
