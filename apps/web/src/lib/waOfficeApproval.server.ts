/**
 * Server half of the office approval reply (see waOfficeApproval.ts).
 *
 * Reads office_tasks to tell the director whether draft #n is still
 * waiting. Never writes it: the n8n receptionist poller reads the same
 * inbound row from wa_messages and owns the pending → approved/rejected
 * transition.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { officeApprovalReply, type OfficeTaskState } from "@/lib/waOfficeApproval";
import { resolveWaIdentityServer } from "@/lib/waRoleResolver.server";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";

/** Who may answer an office draft: the owner, any staff member, any teacher. */
const APPROVER_ROLES = new Set(["owner", "staff", "teacher"]);

async function officeTaskState(id: number): Promise<OfficeTaskState> {
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return "unknown";
    const { data, error } = await ctx.sb
      .from("office_tasks")
      .select("id, approval_state")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.warn("[waOfficeApproval] office_tasks lookup failed", error.message);
      return "unknown";
    }
    if (!data) return "missing";
    const s = String((data as { approval_state?: string }).approval_state ?? "none");
    return s === "pending" || s === "approved" || s === "rejected" ? s : "none";
  } catch (e) {
    console.warn("[waOfficeApproval] office_tasks lookup threw", e);
    return "unknown";
  }
}

/**
 * Returns handled:false for anyone who is not staff, or for text that is
 * not an approval reply, so the message carries on as before.
 */
export async function handleOfficeApprovalReply(opts: {
  fromWaId: string;
  text: string;
}): Promise<{ handled: boolean }> {
  const identity = await resolveWaIdentityServer(opts.fromWaId);
  const isStaff = identity.roles.some((r) => APPROVER_ROLES.has(r.kind));
  if (!isStaff) return { handled: false };
  // Parse first so a non-matching text costs no DB round trip.
  const probe = officeApprovalReply({ text: opts.text, isStaff, state: "unknown", hindi: false });
  if (!probe) return { handled: false };
  const state = await officeTaskState(probe.decision.id);
  // Staff-side menus are the school's working tools and stay in English,
  // as everywhere else in the unified bot (unifiedHindiFor).
  const out = officeApprovalReply({ text: opts.text, isStaff, state, hindi: false });
  if (!out) return { handled: false };
  await sendWhatsAppText({ toMobile: waNormalizeLocal10(opts.fromWaId), body: out.reply });
  return { handled: true };
}
