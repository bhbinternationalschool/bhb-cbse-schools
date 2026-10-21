/**
 * Every missing staff mobile recorded by someone who is not the owner is
 * logged (director, 21 Oct 2026): who, which staff record, when — never the
 * number. The app's audit log (writeAudit), not sis_staff_sensitive_changes:
 * that table records only owner / payroll / accounts authorities by its own
 * check constraint, and changing it would need a migration.
 */
import "server-only";
import type { DemoSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit.server";

export async function logMobileFills(session: DemoSession, staffIds: readonly string[], via: string): Promise<void> {
  for (const id of staffIds) {
    const r = await writeAudit({
      session,
      module: "staff",
      action: "edit",
      entityType: "staff",
      entityId: id,
      summary: `Registered mobile recorded where there was none (${via}) — sign-in link; the number is not logged`,
      after: { field: "mobile", was: "blank" },
    });
    if (!r.ok) console.error(`[staff] mobile fill for ${id} was written but NOT audited: ${r.error}`);
  }
}
