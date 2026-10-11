import "server-only";

import { loadMasters } from "@/lib/masters";
import {
  buildParentsOnApp,
  sessionChildren,
  type AdoptionReport,
  type AppDevice,
  type AppInvite,
  type AppLogin,
  type AppPresence,
  type RosterChild,
} from "@/lib/parentsOnApp";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { isHiddenReviewDemoHousehold, loadSisForStaff } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { fetchAllPages } from "@/lib/supabase/pageAll";

/**
 * Reads and builds the parent app adoption report (lib/parentsOnApp) for a
 * session year — shared by the report (GET) and the invite (POST), so the
 * families the office sees are exactly the families an invite can reach.
 *
 * Sign-ins and push tokens are essential: if either cannot be read the
 * report is an error (unknown is not "nobody is on the app"). App-open
 * stamps and the invite log are additive and reported as available or not;
 * the invite route refuses to send when the invite log is unreadable, since
 * that is what stops a family being invited twice.
 */
export type ParentsOnAppLoad =
  | { ok: true; report: AdoptionReport; presenceAvailable: boolean; invitesAvailable: boolean }
  | { ok: false; status: number; error: string };

export async function loadParentsOnAppReport(sessionAy: string): Promise<ParentsOnAppLoad> {
  if (!sessionAy) return { ok: false, status: 400, error: "Your session has no academic year — sign in again." };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, status: 503, error: "Database unavailable" };

  const [tokens, logins, presence, invites] = await Promise.all([
    fetchAllPages<{ subject_id: string; app_version: string | null; created_at: string; last_seen_at: string }>((from, to) =>
      ctx.sb
        .from("push_device_tokens")
        .select("subject_id, app_version, created_at, last_seen_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("subject_type", "parent")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<{ entity_id: string | null; created_at: string }>((from, to) =>
      ctx.sb
        .from("audit_events")
        .select("entity_id, created_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("entity_type", "parent_session")
        .eq("action", "create")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<{ household_id: string; first_seen_at: string; last_seen_at: string; app_build: number | null }>((from, to) =>
      ctx.sb
        .from("parent_app_presence")
        .select("household_id, first_seen_at, last_seen_at, app_build")
        .eq("tenant_id", ctx.tenantId)
        .order("household_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<{ household_id: string; invited_at: string }>((from, to) =>
      ctx.sb
        .from("parent_app_invites")
        .select("household_id, invited_at")
        .eq("tenant_id", ctx.tenantId)
        .order("household_id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (tokens.error || tokens.truncated) return { ok: false, status: 503, error: "Could not read app devices — try again." };
  if (logins.error || logins.truncated) return { ok: false, status: 503, error: "Could not read app sign-ins — try again." };
  const presenceAvailable = !presence.error && !presence.truncated;
  const invitesAvailable = !invites.error && !invites.truncated;
  if (!presenceAvailable) console.warn("[parents-on-app] presence read failed:", presence.error);
  if (!invitesAvailable) console.warn("[parents-on-app] invites read failed:", invites.error);

  const keep = (id: string) => !!id && !isHiddenReviewDemoHousehold(id);
  const devices: AppDevice[] = tokens.rows
    .map((r) => ({
      householdId: String(r.subject_id ?? ""),
      appVersion: String(r.app_version ?? ""),
      createdAt: String(r.created_at ?? ""),
      lastSeenAt: String(r.last_seen_at ?? ""),
    }))
    .filter((d) => keep(d.householdId));
  const appLogins: AppLogin[] = logins.rows
    .map((r) => ({ householdId: String(r.entity_id ?? ""), at: String(r.created_at ?? "") }))
    .filter((l) => keep(l.householdId));
  const appPresence: AppPresence[] = presenceAvailable
    ? presence.rows
        .map((r) => ({
          householdId: String(r.household_id ?? ""),
          firstSeenAt: String(r.first_seen_at ?? ""),
          lastSeenAt: String(r.last_seen_at ?? ""),
          appBuild: typeof r.app_build === "number" ? r.app_build : null,
        }))
        .filter((p) => keep(p.householdId))
    : [];
  const appInvites: AppInvite[] = invitesAvailable
    ? invites.rows.map((r) => ({ householdId: String(r.household_id ?? ""), invitedAt: String(r.invited_at ?? "") }))
    : [];

  await ensureSchoolMirrorHydrated();
  if (!(await ensureSisHydratedServer())) {
    return { ok: false, status: 503, error: "Could not load the student register — try again." };
  }
  const masters = loadMasters();
  const sis = loadSisForStaff();
  const classes = new Map(masters.classes.map((c) => [c.id, c]));
  const sections = new Map(masters.sections.map((s) => [s.id, s.name]));

  // This session's year only: SIS leaves older-year rows "active", so a
  // family with no row this year has left and must not be counted or invited.
  const children: RosterChild[] = sessionChildren(sis.students, sessionAy).map((s) => {
    const cls = classes.get(s.classId);
    return {
      householdId: s.householdId,
      studentId: s.id,
      name: s.fullName,
      classId: s.classId || "none",
      className: cls?.name ?? "",
      classSort: cls?.sortOrder ?? 999,
      sectionId: s.sectionId || "",
      section: sections.get(s.sectionId) ?? "",
      fatherMobile: s.fatherMobile,
      motherMobile: s.motherMobile,
    };
  });

  const report = buildParentsOnApp({
    devices,
    logins: appLogins,
    presence: appPresence,
    invites: appInvites,
    families: sis.households.map((h) => ({
      householdId: h.id,
      guardianName: h.guardianName,
      whatsappMobile: h.whatsappMobile,
      mobile: h.mobile,
      altMobile: h.altMobile,
    })),
    children,
  });
  return { ok: true, report, presenceAvailable, invitesAvailable };
}
