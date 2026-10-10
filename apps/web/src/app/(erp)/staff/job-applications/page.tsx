import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { loadServerRbac } from "@/lib/api/v1/auth";
import { listJobApplications } from "@/lib/jobApplications.server";
import {
  classLabelsFor,
  sortJobApplications,
  subjectLabelsFor,
} from "@/lib/jobApplications";
import { JobApplicationsInbox } from "@/components/staff/JobApplicationsInbox";

export const metadata: Metadata = { title: "Job applications" };
export const dynamic = "force-dynamic";

export default async function JobApplicationsPage() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") redirect("/login");

  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  const rbac = await loadServerRbac();
  // A CV is a stranger's personal document. Reading the pile is a staff
  // -desk job, not something every logged-in teacher can browse.
  if (!hasPermission(session, masters, "staff", "view", rbac)) {
    redirect("/home");
  }
  const canEdit = hasPermission(session, masters, "staff", "edit", rbac);

  const res = await listJobApplications(200);
  const rows = res.ok
    ? sortJobApplications(res.rows).map((r) => ({
        ...r,
        subjectLabels: subjectLabelsFor(r.subjectIds, masters.subjects),
        classLabels: classLabelsFor(r.classIds, masters.classes),
      }))
    : [];

  const waiting = rows.filter((r) => r.status === "new").length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">
          Job applications
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {waiting
            ? `${waiting} waiting to be looked at.`
            : "Nothing new waiting."}{" "}
          CVs arrive from the public careers page and from WhatsApp job
          enquiries; the subject and classes are read from the CV itself.
        </p>
        {!res.ok ? (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Couldn&apos;t load applications: {res.error}
          </p>
        ) : null}
      </header>
      <JobApplicationsInbox initialRows={rows} canEdit={canEdit} />
    </div>
  );
}
