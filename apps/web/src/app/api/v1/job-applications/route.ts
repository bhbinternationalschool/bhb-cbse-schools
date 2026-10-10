/**
 * The office's side of the careers page: list applications, move one
 * along. Staff only, and gated on `staff:view` / `staff:edit` — a CV is a
 * stranger's personal document and a teaching vacancy is not staffroom
 * news, so this is not readable by every logged-in teacher.
 */

import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { loadServerRbac } from "@/lib/api/v1/auth";
import {
  listJobApplications,
  setJobApplicationStatus,
} from "@/lib/jobApplications.server";
import {
  sortJobApplications,
  type JobApplicationStatus,
} from "@/lib/jobApplications";

export const runtime = "nodejs";

const STATUSES: JobApplicationStatus[] = [
  "new",
  "shortlisted",
  "interviewed",
  "rejected",
  "hired",
];

export async function GET(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  const rbac = await loadServerRbac();
  if (!hasPermission(auth.ctx.session, masters, "staff", "view", rbac)) {
    return NextResponse.json(
      { error: "Staff view permission required" },
      { status: 403 },
    );
  }
  const res = await listJobApplications(200);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ok: true, rows: sortJobApplications(res.rows) });
}

export async function PATCH(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  const rbac = await loadServerRbac();
  // Moving an application along is a decision about a person, so it needs
  // edit, not view — and it records who made it.
  if (!hasPermission(auth.ctx.session, masters, "staff", "edit", rbac)) {
    return NextResponse.json(
      { error: "Staff edit permission required" },
      { status: 403 },
    );
  }
  let body: { id?: unknown; status?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  const status = String(body.status ?? "") as JobApplicationStatus;
  if (!id || !STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `id and status (${STATUSES.join(" | ")}) required` },
      { status: 400 },
    );
  }
  const session = auth.ctx.session;
  const res = await setJobApplicationStatus({
    id,
    status,
    by: session.fullName || session.email || "staff",
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
