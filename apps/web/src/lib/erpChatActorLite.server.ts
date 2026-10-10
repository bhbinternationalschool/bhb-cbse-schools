/**
 * Resolve a chat actor without pulling the 4.13 MB school_mirror_state
 * blob. Fixes the actual driver of high Supabase egress: /api/chat's GET
 * is polled every 8s by StaffInternalChatButton, mounted globally in
 * AppShell — so every logged-in staff member's browser was triggering
 * that pull, throttled only per Cloud Run instance (45s TTL, not global),
 * for as long as any tab stayed open. See
 * docs/EGRESS_FINDINGS.md for the full investigation.
 *
 * resolveChatActor()'s own matching logic is untouched — this only
 * changes where its masters/sis arguments come from: a single targeted
 * row by id instead of the whole mirror, when the session already carries
 * staffId/householdId (which it does for any session minted after this
 * month's /api/auth/session and OTP work — both set it directly). Falls
 * back to null (caller re-tries the full mirror path) for the rarer case
 * of a session with neither id, rather than replicate every fuzzy-match
 * rule here and risk diverging from the real logic.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import { emptySisState, normalizeHousehold, type SisState } from "@/lib/sis";
import { normalizeStaffRecord } from "@/lib/foundationMasters";
import {
  resolveChatActor,
  type ChatActor,
} from "@/lib/erpChatAccess";
import type { SessionLike } from "@/lib/rbac";

export async function resolveChatActorLite(
  session: SessionLike & { householdId?: string; academicYearCode?: string },
): Promise<ChatActor | null> {
  const sb = (await getServerTenantContext())?.sb;
  if (!sb) return null;

  const persona = (session.persona || "staff").toLowerCase();

  if (persona === "parent" || (session.roleCode || "").toLowerCase() === "parent") {
    if (!session.householdId) return null;
    const { data } = await sb
      .from("sis_households")
      .select("id, guardian_name, mobile, whatsapp_mobile, alt_mobile")
      .eq("id", session.householdId)
      .maybeSingle();
    if (!data) return null;

    const sisShell: SisState = {
      ...emptySisState(),
      households: [
        normalizeHousehold({
          id: data.id as string,
          guardianName: (data.guardian_name as string) || "",
          mobile: (data.mobile as string) || "",
          whatsappMobile: (data.whatsapp_mobile as string) || "",
          altMobile: (data.alt_mobile as string) || "",
        }),
      ],
    };
    return resolveChatActor(session, emptyMastersShell(), sisShell);
  }

  if (!session.staffId) return null;
  const [{ data: staffRow }, { data: desigRows }] = await Promise.all([
    sb
      .from("sis_staff")
      .select("id, emp_code, full_name, email, mobile, status, stream, designation_id")
      .eq("id", session.staffId)
      .maybeSingle(),
    sb.from("sis_designations").select("id, code, name"),
  ]);
  if (!staffRow) return null;

  const mastersShell: MastersState = {
    ...emptyMastersShell(),
    designations: (desigRows ?? []).map((d) => ({
      id: d.id as string,
      code: (d.code as string) || "",
      name: (d.name as string) || "",
      departmentId: null,
      isActive: true,
    })),
    staff: [
      normalizeStaffRecord({
        id: staffRow.id as string,
        empCode: (staffRow.emp_code as string) || "",
        fullName: (staffRow.full_name as string) || "",
        email: (staffRow.email as string) || "",
        mobile: (staffRow.mobile as string) || "",
        status: staffRow.status === "inactive" ? "inactive" : "active",
        stream:
          staffRow.stream === "non_teaching" ? "non_teaching" : "teaching",
        designationId: (staffRow.designation_id as string) || null,
      }),
    ],
  };
  return resolveChatActor(session, mastersShell, emptySisState());
}
