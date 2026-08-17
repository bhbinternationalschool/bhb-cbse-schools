"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Accessibility } from "lucide-react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { isModuleEnabled, setModuleEnabled } from "@/lib/moduleRegistry";
import { loadSis, type SisState } from "@/lib/sis";
import { useModuleTabQuery } from "@/lib/useModuleTabQuery";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import {
  applicationStatusLabel,
  assignLotteryNumbers,
  deleteQuotaApplication,
  deleteQuotaSeat,
  formatPortalDob,
  importGovtAllottedSeatRows,
  importGovtRteList,
  listEnrolledRteStudents,
  listQuotaSeatRows,
  markRteRegistrationFeePaid,
  matrixFromGovtAllottedSeatFile,
  quotaTypeLabel,
  registrationFeeLabel,
  RTE_REPORTS,
  runRteReport,
  saveRteSettings,
  seedQuotaSeatsFromStrength,
  seedRteIfEmpty,
  sendAllottedRteToSis,
  setApplicationStatus,
  sortGovtAllottedApps,
  suggestSeatTotal,
  takeSchoolAdmission,
  upsertQuotaApplication,
  upsertQuotaSeat,
  type QuotaApplication,
  type QuotaApplicationStatus,
  type QuotaType,
  type RteReportId,
  type RteState,
} from "@/lib/rteEws";

type RteTab =
  | "dashboard"
  | "kpis"
  | "applications"
  | "enrolled"
  | "settings"
  | "reports";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Seats", tone: "navy" },
  { id: "kpis", label: "Dashboard", tone: "sky" },
  { id: "applications", label: "Govt list", tone: "teal" },
  { id: "enrolled", label: "Enrolled", tone: "green" },
  { id: "settings", label: "Settings", tone: "amber" },
  { id: "reports", label: "Reports", tone: "slate" },
];

export function RteWorkspace({
  embedded = false,
}: {
  /** When true, hide page chrome (used under Admissions › RTE / EWS). */
  embedded?: boolean;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useModuleTabQuery<RteTab>("dashboard", [
    "dashboard",
    "kpis",
    "applications",
    "enrolled",
    "settings",
    "reports",
  ]);
  const [enabled, setEnabled] = useState(true);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [state, setState] = useState<RteState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [seatClassId, setSeatClassId] = useState("");
  const [seatType, setSeatType] = useState<QuotaType>("RTE");
  const [seatTotal, setSeatTotal] = useState("5");

  const [appName, setAppName] = useState("");
  const [appParent, setAppParent] = useState("");
  const [appMobile, setAppMobile] = useState("");
  const [appClassId, setAppClassId] = useState("");
  const [appType, setAppType] = useState<QuotaType>("RTE");
  const [appCategory, setAppCategory] = useState("EWS");
  const [appIncome, setAppIncome] = useState("");
  const [appGovtNo, setAppGovtNo] = useState("");
  const [govtImportRaw, setGovtImportRaw] = useState("");
  const [defaultRegFeeRs, setDefaultRegFeeRs] = useState("500");

  const [mandatedPct, setMandatedPct] = useState(25);
  const [autoWaiver, setAutoWaiver] = useState(true);
  const [reportFormat, setReportFormat] = useState<"excel" | "pdf">("excel");

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    setEnabled(isModuleEnabled("rte_ews"));
    setMasters(loadMasters());
    setSis(loadSis());
    const rte = seedRteIfEmpty(ay);
    setState(rte);
    setMandatedPct(rte.settings.mandatedPct);
    setAutoWaiver(rte.settings.autoApplyFeeWaiver);
    const classes = loadMasters().classes.filter((c) => c.isActive !== false);
    if (!seatClassId && classes[0]) setSeatClassId(classes[0].id);
    if (!appClassId && classes[0]) setAppClassId(classes[0].id);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const [{ ensureRteHydrated }, { withHydrationSlot }] = await Promise.all([
        import("@/lib/rtePersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      await withHydrationSlot(() => ensureRteHydrated());
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  const classes = useMemo(
    () => (masters?.classes ?? []).filter((c) => c.isActive !== false),
    [masters],
  );

  const seatRows = useMemo(
    () => (state && masters && sis ? listQuotaSeatRows(state, ay, masters, sis) : []),
    [state, ay, masters, sis],
  );

  const apps = useMemo(() => {
    if (!state) return [];
    return sortGovtAllottedApps(
      state.applications.filter((a) => a.academicYearCode === ay),
    );
  }, [state, ay]);

  const enrolled = useMemo(() => listEnrolledRteStudents(sis ?? undefined), [sis]);

  const fillSummary = useMemo(() => {
    const total = seatRows.reduce((s, r) => s + r.total, 0);
    const filled = seatRows.reduce((s, r) => s + r.filled, 0);
    return { total, filled, pct: total ? Math.round((filled / total) * 100) : 0 };
  }, [seatRows]);

  if (!enabled) {
    return (
      <div className={embedded ? "py-6" : "mx-auto max-w-xl px-4 py-10"}>
        <h1 className="text-xl font-semibold text-[var(--brand-deep)]">
          RTE / EWS is disabled
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Turn on this module under Owner → Modules to manage quota seats and
          applications.
        </p>
        <Link href="/modules" className={`${btn} mt-4 inline-block`}>
          Open Modules
        </Link>
      </div>
    );
  }

  if (!state || !masters) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--muted)]">Loading RTE…</div>
    );
  }

  return (
    <ErpWorkspaceShell
      embedded={embedded}
      title="RTE / EWS"
      subtitle={
        embedded
          ? `Govt list · seats · lottery · allot → SIS with RTE/EWS tags · ${ay}`
          : `Quota seats · applications · lottery · enrolled (§21c) · ${ay}`
      }
      icon={<Accessibility className="size-6" aria-hidden />}
      error={error}
      notice={notice}
      actions={
        embedded ? undefined : (
          <>
            <Link href="/modules" className={btnOutline}>
              Modules
            </Link>
            <Link href="/admissions?tab=rte" className={btnOutline}>
              ← Admissions
            </Link>
          </>
        )
      }
      toolbar={
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <p className="text-[11px] text-[var(--muted)]">Mandated seats</p>
            <p className="text-xl font-semibold text-[var(--brand-deep)]">
              {fillSummary.total}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <p className="text-[11px] text-[var(--muted)]">Filled</p>
            <p className="text-xl font-semibold text-[var(--brand-deep)]">
              {fillSummary.filled}{" "}
              <span className="text-sm font-normal text-[var(--muted)]">
                ({fillSummary.pct}%)
              </span>
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <p className="text-[11px] text-[var(--muted)]">
              Assigned · not admitted
            </p>
            <p className="text-xl font-semibold text-[var(--brand-deep)]">
              {
                apps.filter(
                  (a) =>
                    a.status === "govt_assigned" ||
                    a.status === "submitted" ||
                    a.status === "waitlist",
                ).length
              }
            </p>
          </div>
        </div>
      }
    >
      <ModuleTabs
        items={TABS}
        value={tab}
        onChange={(id) => setTab(id as RteTab)}
      />

      {tab === "dashboard" ? (
        <section className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <label className="text-xs text-[var(--muted)]">
              Class
              <select
                className={`${field} mt-0.5 block`}
                value={seatClassId}
                onChange={(e) => setSeatClassId(e.target.value)}
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">
              Type
              <select
                className={`${field} mt-0.5 block`}
                value={seatType}
                onChange={(e) => setSeatType(e.target.value as QuotaType)}
              >
                <option value="RTE">RTE</option>
                <option value="EWS">EWS</option>
                <option value="SCHOLARSHIP">Scholarship</option>
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">
              Total seats
              <input
                className={`${field} mt-0.5 block w-20`}
                value={seatTotal}
                onChange={(e) => setSeatTotal(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={`${btn} self-end`}
              onClick={() => {
                const r = upsertQuotaSeat({
                  classId: seatClassId,
                  academicYearCode: ay,
                  type: seatType,
                  total: Number(seatTotal) || 0,
                });
                if (!r.ok) return setError(r.error);
                refresh();
                flash("Seat row saved");
              }}
            >
              Save seat
            </button>
            <button
              type="button"
              className={`${btnOutline} self-end`}
              onClick={() => {
                const n = suggestSeatTotal(
                  seatClassId,
                  state.settings.mandatedPct,
                  sis ?? undefined,
                );
                setSeatTotal(String(n));
              }}
            >
              Suggest {state.settings.mandatedPct}%
            </button>
            <button
              type="button"
              className={`${btnOutline} self-end`}
              onClick={() => {
                seedQuotaSeatsFromStrength({ academicYearCode: ay });
                refresh();
                flash("Seeded seats from class strength");
              }}
            >
              Seed all classes
            </button>
          </div>

          <ul className="space-y-2">
            {seatRows.length === 0 ? (
              <li className="text-sm text-[var(--muted)]">
                No seat rows yet — seed from strength or add manually.
              </li>
            ) : (
              seatRows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--brand-deep)]">
                      {row.className} · {quotaTypeLabel(row.type)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {row.filled}/{row.total} filled · {row.remaining} left ·
                      SIS {row.enrolled} · allotted {row.allotted}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-[var(--danger)] underline"
                    onClick={() => {
                      const r = deleteQuotaSeat(row.id);
                      if (!r.ok) setError(r.error);
                      else {
                        refresh();
                        flash("Removed");
                      }
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}

      {tab === "kpis" ? (
        <div className="mt-4">
          <ModuleDashboardHost
            moduleId="rte"
            onNavigateTab={(t) => setTab(t as RteTab)}
          />
        </div>
      ) : null}

      {tab === "applications" ? (
        <section className="mt-4 space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-[rgba(14,90,140,0.06)] px-4 py-3 text-sm text-[var(--brand-deep)]">
            <p className="font-semibold">Govt list ≠ admission</p>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              Import the official list assigned to this school. Status stays
              “govt assigned” until the school takes admission. At that step
              choose whether to collect, waive, or skip registration fee.
              Confirm admission → then Send to SIS.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              Import govt AllottedSeat list
            </h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Supports both UP RTE portal downloads named{" "}
              <code className="text-[10px]">AllottedSeat.xls</code>:
              (1) Student Admission Module export — Lottery No + Admission
              Status; (2) HTML list export — Registration ID, Class, Gender,
              DOB, Father Name (no lottery). Neither is school admission —
              take admission separately. Re-import is safe: same Registration
              ID (or Name + DOB) in this year will not create a second student;
              portal columns may refresh if still not admitted.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs text-[var(--muted)]">
                Upload .xls / .xlsx / .csv
                <input
                  type="file"
                  accept=".xls,.xlsx,.csv,.txt,.html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/html"
                  className={`${field} mt-0.5 block max-w-xs text-xs file:mr-2`}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      const buf = await file.arrayBuffer();
                      const { matrix, source } =
                        await matrixFromGovtAllottedSeatFile(buf);
                      const r = importGovtAllottedSeatRows({
                        matrix,
                        academicYearCode: ay,
                        defaultClassId: appClassId,
                        type: appType,
                      });
                      refresh();
                      if (!r.imported && r.errors[0]) {
                        setError(r.errors[0]);
                        return;
                      }
                      const fmt =
                        r.format === "up_rte_allotted_seat_module"
                          ? "module export (lottery + status)"
                          : r.format === "up_rte_allotted_seat_list"
                            ? "list export (HTML/grid)"
                            : r.format;
                      flash(
                        `Imported ${r.imported}` +
                          (r.duplicates
                            ? ` · duplicates ${r.duplicates}`
                            : "") +
                          (r.updated
                            ? ` (${r.updated} portal fields refreshed)`
                            : "") +
                          (r.skipped && !r.duplicates
                            ? ` · skipped ${r.skipped}`
                            : "") +
                          ` · ${fmt}` +
                          (source === "html" ? " · read as HTML" : ""),
                      );
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Could not read spreadsheet",
                      );
                    }
                  }}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Default class (if Class blank)
                <select
                  className={`${field} mt-0.5 block`}
                  value={appClassId}
                  onChange={(e) => setAppClassId(e.target.value)}
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--muted)]">
                Type
                <select
                  className={`${field} mt-0.5 block`}
                  value={appType}
                  onChange={(e) => setAppType(e.target.value as QuotaType)}
                >
                  <option value="RTE">RTE</option>
                  <option value="EWS">EWS</option>
                  <option value="SCHOLARSHIP">Scholarship</option>
                </select>
              </label>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[var(--muted)]">
                Or paste CSV / TSV
              </summary>
              <textarea
                className={`${field} mt-2 min-h-[80px] w-full font-mono text-xs`}
                placeholder={`Registration ID,Student Name,Father Name,Class,...\n101531,NIPENDRA PATEL,NAGESH PATEL,LKG`}
                value={govtImportRaw}
                onChange={(e) => setGovtImportRaw(e.target.value)}
              />
              <button
                type="button"
                className={`${btn} mt-2`}
                onClick={() => {
                  if (!govtImportRaw.trim()) {
                    setError("Paste the govt list or upload AllottedSeat.xls");
                    return;
                  }
                  const r = importGovtRteList({
                    raw: govtImportRaw,
                    academicYearCode: ay,
                    defaultClassId: appClassId,
                    type: appType,
                  });
                  setGovtImportRaw("");
                  refresh();
                  flash(
                    `Imported ${r.imported}` +
                      (r.duplicates ? ` · duplicates ${r.duplicates}` : "") +
                      (r.updated
                        ? ` (${r.updated} portal fields refreshed)`
                        : ""),
                  );
                }}
              >
                Import paste
              </button>
            </details>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              Add one (govt assigned)
            </h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Saves as govt assigned only — take admission separately below.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className={`${field} w-40`}
                placeholder="Govt app no. *"
                value={appGovtNo}
                onChange={(e) => setAppGovtNo(e.target.value)}
              />
              <input
                className={`${field} min-w-[140px]`}
                placeholder="Child name"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
              />
              <input
                className={`${field} min-w-[120px]`}
                placeholder="Parent"
                value={appParent}
                onChange={(e) => setAppParent(e.target.value)}
              />
              <input
                className={`${field} w-32`}
                placeholder="Mobile"
                value={appMobile}
                onChange={(e) => setAppMobile(e.target.value)}
              />
              <select
                className={field}
                value={appClassId}
                onChange={(e) => setAppClassId(e.target.value)}
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className={field}
                value={appType}
                onChange={(e) => setAppType(e.target.value as QuotaType)}
              >
                <option value="RTE">RTE</option>
                <option value="EWS">EWS</option>
                <option value="SCHOLARSHIP">Scholarship</option>
              </select>
              <select
                className={field}
                value={appCategory}
                onChange={(e) => setAppCategory(e.target.value)}
              >
                {["GEN", "OBC", "SC", "ST", "EWS"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                className={`${field} w-28`}
                placeholder="Income"
                value={appIncome}
                onChange={(e) => setAppIncome(e.target.value)}
              />
              <button
                type="button"
                className={btn}
                onClick={() => {
                  if (!appGovtNo.trim()) {
                    setError("Govt application number required");
                    return;
                  }
                  if (!appName.trim()) {
                    setError("Child name required");
                    return;
                  }
                  const r = upsertQuotaApplication({
                    childName: appName,
                    parentName: appParent,
                    mobile: appMobile,
                    classId: appClassId,
                    academicYearCode: ay,
                    type: appType,
                    category: appCategory,
                    annualIncome: appIncome,
                    govtApplicationNo: appGovtNo.trim(),
                    docsIncome: true,
                    docsCategory: true,
                    status: "govt_assigned",
                    note: "Manual add from govt list — not admitted yet",
                  });
                  if (!r.ok) return setError(r.error);
                  setAppName("");
                  setAppParent("");
                  setAppMobile("");
                  setAppGovtNo("");
                  refresh();
                  flash("Added to govt assigned list (not admitted)");
                }}
              >
                Add to list
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs text-[var(--muted)]">
                Default reg. fee (₹) when collecting
                <input
                  className={`${field} mt-0.5 block w-24`}
                  value={defaultRegFeeRs}
                  onChange={(e) => setDefaultRegFeeRs(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  const r = assignLotteryNumbers(ay, "RTE");
                  if (!r.ok) return setError(r.error);
                  refresh();
                  flash(`Lottery assigned to ${r.count} application(s)`);
                }}
              >
                Assign lottery (RTE pool)
              </button>
            </div>
          </div>

          <ErpTableShell className="overflow-x-auto">
            {apps.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--muted)]">
                No govt-assigned candidates yet — import AllottedSeat.xls.
              </p>
            ) : (
              <ErpTable minWidth="min-w-[1100px]" className="border-collapse text-xs">
                <ErpTableHead>
                  <tr>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      S.No.
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Lottery No
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Registration ID
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Student Name
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Father Name
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Class
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Gender
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      DOB
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Block/Town
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Grampanchayat/Ward
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Admission Status (portal)
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      School status
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Reg. fee
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">
                      Take admission
                    </th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {apps.map((a, i) => (
                    <AppTableRow
                      key={a.id}
                      app={a}
                      displaySerial={a.portalSerialNo || String(i + 1)}
                      className={
                        masters.classes.find((c) => c.id === a.classId)?.name ||
                        "—"
                      }
                      actorName={session.fullName || "Staff"}
                      defaultRegFeeRs={defaultRegFeeRs}
                      onRefresh={refresh}
                      onFlash={flash}
                      onError={setError}
                    />
                  ))}
                </ErpTableBody>
              </ErpTable>
            )}
          </ErpTableShell>
        </section>
      ) : null}

      {tab === "enrolled" ? (
        <section className="mt-4">
          <p className="mb-2 text-sm text-[var(--muted)]">
            Active SIS students with fee type RTE or category EWS (from
            Admissions / Students).
          </p>
          <ul className="space-y-2">
            {enrolled.length === 0 ? (
              <li className="text-sm text-[var(--muted)]">
                None yet — enroll with RTE flag in Admissions.
              </li>
            ) : (
              enrolled.map((s) => (
                <li
                  key={s.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm"
                >
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {s.fullName}
                  </span>
                  <span className="text-[var(--muted)]">
                    {" "}
                    ·{" "}
                    {masters.classes.find((c) => c.id === s.classId)?.name ||
                      "—"}{" "}
                    · {s.studentType}
                    {s.category ? ` · ${s.category}` : ""}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="mt-4 max-w-lg space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <label className="block text-xs text-[var(--muted)]">
            Mandated quota %
            <input
              type="number"
              min={1}
              max={100}
              className={`${field} mt-1 block w-24`}
              value={mandatedPct}
              onChange={(e) => setMandatedPct(Number(e.target.value) || 25)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={autoWaiver}
              onChange={(e) => setAutoWaiver(e.target.checked)}
            />
            Prefer Masters RTE / EWS concession on enroll
          </label>
          <button
            type="button"
            className={btn}
            onClick={() => {
              saveRteSettings({
                mandatedPct,
                autoApplyFeeWaiver: autoWaiver,
              });
              refresh();
              flash("Settings saved");
            }}
          >
            Save settings
          </button>
          <hr className="border-[var(--border)]" />
          <p className="text-sm text-[var(--muted)]">
            Module enable / disable is controlled from Modules registry
            (default OFF).
          </p>
          <button
            type="button"
            className={btnOutline}
            onClick={() => {
              setModuleEnabled("rte_ews", false);
              refresh();
              flash("RTE / EWS disabled");
            }}
          >
            Disable module
          </button>
        </section>
      ) : null}

      {tab === "reports" ? (
        <section className="mt-4 space-y-3">
          <label className="text-xs text-[var(--muted)]">
            Format
            <select
              className={`${field} ml-2`}
              value={reportFormat}
              onChange={(e) =>
                setReportFormat(e.target.value as "excel" | "pdf")
              }
            >
              <option value="excel">Excel</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <ul className="space-y-2">
            {RTE_REPORTS.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--brand-deep)]">
                    {r.label}
                  </p>
                  {r.hint ? (
                    <p className="text-xs text-[var(--muted)]">{r.hint}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    const res = runRteReport(r.id as RteReportId, {
                      format: reportFormat,
                      academicYearCode: ay,
                      rte: state,
                    });
                    if (!res.ok) setError(res.error);
                    else flash(res.message);
                  }}
                >
                  Export
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </ErpWorkspaceShell>
  );
}

function AppTableRow({
  app,
  displaySerial,
  className,
  actorName,
  defaultRegFeeRs,
  onRefresh,
  onFlash,
  onError,
}: {
  app: QuotaApplication;
  displaySerial: string;
  className: string;
  actorName: string;
  defaultRegFeeRs: string;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [feeMode, setFeeMode] = useState<"collect" | "waive" | "none">(
    "collect",
  );
  const [feeRs, setFeeRs] = useState(defaultRegFeeRs);
  const [showAdmit, setShowAdmit] = useState(false);

  useEffect(() => {
    setFeeRs(defaultRegFeeRs);
  }, [defaultRegFeeRs]);

  const canAdmit =
    app.status === "govt_assigned" ||
    app.status === "submitted" ||
    app.status === "waitlist";
  const isAdmitted =
    (app.status === "admitted" || app.status === "allotted") && !app.studentId;
  const needsFee =
    isAdmitted &&
    app.registrationFeeChoice === "collect" &&
    !app.registrationFeePaid;

  function setStatus(status: QuotaApplicationStatus) {
    const r = setApplicationStatus({
      id: app.id,
      status,
      by: actorName,
    });
    if (!r.ok) return onError(r.error);
    onRefresh();
    onFlash(`${applicationStatusLabel(status)}`);
  }

  function confirmAdmission() {
    if (!app.govtApplicationNo.trim()) {
      onError("Govt application number required before admission");
      return;
    }
    const amountPaise =
      feeMode === "collect" ? Math.round((Number(feeRs) || 0) * 100) : 0;
    if (feeMode === "collect" && amountPaise <= 0) {
      onError("Enter registration fee amount, or choose Waive / No fee");
      return;
    }
    const r = takeSchoolAdmission({
      applicationId: app.id,
      by: actorName,
      registrationFee: feeMode,
      amountPaise,
    });
    if (!r.ok) return onError(r.error);
    setShowAdmit(false);
    onRefresh();
    onFlash(
      feeMode === "collect"
        ? `Admitted · collect ₹${(amountPaise / 100).toFixed(0)} reg. fee`
        : feeMode === "waive"
          ? "Admitted · registration fee waived"
          : "Admitted · no registration fee",
    );
  }

  const td = "whitespace-nowrap px-2 py-2 align-top text-[var(--brand-deep)]";
  const feeText =
    app.registrationFeeChoice !== "pending"
      ? registrationFeeLabel(app)
      : "—";

  return (
    <>
      <tr className="hover:bg-[var(--surface-sunken)]">
        <td className={td}>{displaySerial}</td>
        <td className={td}>{app.lotteryNo || "—"}</td>
        <td className={`${td} font-medium`}>{app.govtApplicationNo || "—"}</td>
        <td className={`${td} font-semibold`}>{app.childName}</td>
        <td className={td}>{app.parentName || "—"}</td>
        <td className={td}>{className}</td>
        <td className={td}>{app.gender || "—"}</td>
        <td className={td}>{formatPortalDob(app.dateOfBirth)}</td>
        <td className={td}>{app.blockTown || "—"}</td>
        <td className={td}>{app.gramPanchayatWard || "—"}</td>
        <td className={`${td} max-w-[160px] whitespace-normal`}>
          {app.portalAdmissionStatus?.trim() || "—"}
        </td>
        <td className={td}>
          {applicationStatusLabel(app.status)}
          {app.studentId ? " · SIS" : ""}
        </td>
        <td className={`${td} max-w-[120px] whitespace-normal`}>{feeText}</td>
        <td className="px-2 py-2 align-top">
          <div className="flex min-w-[140px] flex-col gap-1">
            {canAdmit ? (
              <>
                <button
                  type="button"
                  className={btn}
                  onClick={() => setShowAdmit((v) => !v)}
                >
                  {showAdmit ? "Cancel" : "Take admission"}
                </button>
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => setStatus("waitlist")}
                >
                  Waitlist
                </button>
                <button
                  type="button"
                  className="text-left text-[11px] text-[var(--danger)] underline"
                  onClick={() => setStatus("rejected")}
                >
                  Reject
                </button>
              </>
            ) : null}
            {needsFee ? (
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  const r = markRteRegistrationFeePaid(app.id);
                  if (!r.ok) return onError(r.error);
                  onRefresh();
                  onFlash("Registration fee marked paid");
                }}
              >
                Mark fee paid
              </button>
            ) : null}
            {isAdmitted && !needsFee ? (
              <button
                type="button"
                className={btn}
                onClick={() => {
                  const r = sendAllottedRteToSis({
                    applicationId: app.id,
                    by: actorName,
                  });
                  if (!r.ok) return onError(r.error);
                  onRefresh();
                  onFlash(`SIS ${r.admissionNo} · RTE/EWS tags`);
                }}
              >
                Send to SIS
              </button>
            ) : null}
            <button
              type="button"
              className="text-left text-[11px] text-[var(--danger)] underline"
              onClick={() => {
                const r = deleteQuotaApplication(app.id);
                if (!r.ok) onError(r.error);
                else {
                  onRefresh();
                  onFlash("Deleted");
                }
              }}
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {showAdmit && canAdmit ? (
        <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)]">
          <td colSpan={14} className="px-3 py-3">
            <p className="text-xs font-medium text-[var(--brand-deep)]">
              Confirm school admission for {app.childName} — registration fee?
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-[var(--brand-deep)]">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`fee-${app.id}`}
                  checked={feeMode === "collect"}
                  onChange={() => setFeeMode("collect")}
                />
                Collect fee
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`fee-${app.id}`}
                  checked={feeMode === "waive"}
                  onChange={() => setFeeMode("waive")}
                />
                Waive
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`fee-${app.id}`}
                  checked={feeMode === "none"}
                  onChange={() => setFeeMode("none")}
                />
                No fee
              </label>
            </div>
            {feeMode === "collect" ? (
              <label className="mt-2 block text-xs text-[var(--muted)]">
                Amount (₹)
                <input
                  className={`${field} mt-0.5 block w-28`}
                  value={feeRs}
                  onChange={(e) => setFeeRs(e.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              className={`${btn} mt-3`}
              onClick={confirmAdmission}
            >
              Confirm admission
            </button>
          </td>
        </tr>
      ) : null}
    </>
  );
}
