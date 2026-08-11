"use client";

import { useEffect, useMemo, useState } from "react";
import { Award, Sparkles } from "lucide-react";
import {
  CERTIFICATE_KINDS,
  categoryForTc,
  certificateEligibility,
  certificateKindLabel,
  classLabelForStudent,
  classToWords,
  defaultSubjectsForClass,
  emptyTcDetails,
  formatCertDate,
  issueCertificate,
  listCertificates,
  loadCertificates,
  previewFeesPaidForStudent,
  suggestNextCertificateNumber,
  voidCertificate,
  type CertificateIssue,
  type CertificateKind,
  type TcDetails,
} from "@/lib/certificates";
import {
  formatInr,
  searchFeeStudents,
  type StudentSearchHit,
} from "@/lib/fees";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  designationName,
  resolveClassTeacherName,
  resolvePrincipal,
} from "@/lib/staffResolve";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { ErpTableShell } from "@/components/ui/erp-roster";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { CertificatesReportsRunner } from "@/components/reports/ModuleReportRunners";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StudentHitsFilterExport } from "@/components/reports/StudentHitsFilterExport";
import {
  CertificateSheet,
  printCertificate,
} from "@/components/certificates/CertificateSheet";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  HoldStatusBanner,
  PrincipalHoldOverrideDialog,
} from "@/components/fees/PrincipalHoldOverrideDialog";
import {
  checkHold,
  holdCodeForCertificate,
  type HoldCheck,
} from "@/lib/holds";
import type { HoldCode } from "@/lib/types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type Tab = "dashboard" | "desk" | "reports";

export function CertificatesWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<Tab>("desk");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [issues, setIssues] = useState<CertificateIssue[]>([]);
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [selected, setSelected] = useState<StudentSearchHit | null>(null);
  const [kind, setKind] = useState<CertificateKind>("bonafide");
  const [issuedOn, setIssuedOn] = useState(todayIso);
  const [admissionDate, setAdmissionDate] = useState("");
  const [leavingDate, setLeavingDate] = useState(todayIso);
  const [reasonForLeaving, setReasonForLeaving] = useState("");
  const [lastClassStudied, setLastClassStudied] = useState("");
  const [promotedTo, setPromotedTo] = useState("");
  const [conduct, setConduct] = useState("Good");
  const [remarks, setRemarks] = useState("");
  const [holdCheck, setHoldCheck] = useState<HoldCheck | null>(null);
  const [holdDialog, setHoldDialog] = useState(false);
  const [holdCode, setHoldCode] = useState<HoldCode>("HOLD_CERT");
  const [inactivateOnTc, setInactivateOnTc] = useState(true);
  const [tcForm, setTcForm] = useState<TcDetails>(emptyTcDetails);
  const [pen, setPen] = useState("");
  const [apaarId, setApaarId] = useState("");
  const [feesFrom, setFeesFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-04-01`;
  });
  const [feesTo, setFeesTo] = useState(todayIso);
  const [feesClaimFor, setFeesClaimFor] = useState(
    "Employer reimbursement / tax claim",
  );
  const [feesIncludeSiblings, setFeesIncludeSiblings] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [voidTargetId, setVoidTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [aiLanguage, setAiLanguage] = useState<"en" | "hi" | "both">("both");
  const [aiPurpose, setAiPurpose] = useState("");
  const [aiDetails, setAiDetails] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [customIsAi, setCustomIsAi] = useState(false);

  function refresh() {
    const m = loadMasters();
    const s = loadSis();
    setMasters(m);
    setSis(s);
    setIssues(listCertificates(loadCertificates()));
    setTick((x) => x + 1);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const { ensureCertificatesHydrated } = await import(
        "@/lib/certificatesPersistence"
      );
      await ensureCertificatesHydrated();
      refresh();
    })();
  }, []);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter((s) => s.classId === classId && s.isActive);
  }, [masters, classId]);

  useEffect(() => {
    if (!sectionId) return;
    if (!sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      searchFeeStudents(query, sis, masters, undefined, {
        classId,
        sectionId,
        includeInactive: true,
      }),
    );
  }, [query, classId, sectionId, sis, masters, tick]);

  const student = selected?.student ?? null;

  const eligibility = useMemo(() => {
    if (!student) return null;
    return certificateEligibility(student, kind);
  }, [student, kind, tick]);

  useEffect(() => {
    const code = holdCodeForCertificate(kind);
    if (!student || !code) {
      setHoldCheck(null);
      return;
    }
    setHoldCode(code);
    setHoldCheck(checkHold(student.id, code));
  }, [student?.id, kind, tick]);

  useEffect(() => {
    if (!student) {
      setLastClassStudied("");
      setPen("");
      setApaarId("");
      return;
    }
    const label = classLabelForStudent(student);
    setLastClassStudied(label);
    setPen(student.pen || "");
    setApaarId(student.apaarId || "");
    setTcForm((prev) => ({
      ...prev,
      nationality: student.nationality || "Indian",
      category: categoryForTc(student.category),
      admissionClass: label.split("-")[0] || label,
      lastClassFigures: label,
      lastClassWords: classToWords(label),
      subjectsStudied: defaultSubjectsForClass(label),
      applicationDate: leavingDate || todayIso(),
      checkedByName: prev.checkedByName || session.fullName,
      checkedByDesignation:
        prev.checkedByDesignation ||
        (() => {
          const m = loadMasters();
          const me = m.staff.find(
            (s) =>
              s.fullName === session.fullName ||
              s.loginUsername === session.email,
          );
          return me
            ? designationName(m, me.designationId)
            : prev.checkedByDesignation;
        })(),
    }));
  }, [student?.id]);

  // Show resolved class teacher hint when student selected
  const resolvedClassTeacher = useMemo(() => {
    if (!student || !masters) return "";
    return resolveClassTeacherName(
      masters,
      student.classId,
      student.sectionId,
      student.academicYearCode || session.academicYearCode || DEFAULT_AY,
    );
  }, [student, masters, session.academicYearCode]);

  function patchTc(patch: Partial<TcDetails>) {
    setTcForm((prev) => ({ ...prev, ...patch }));
  }

  const feesPaidPreview = useMemo(() => {
    if (!student || kind !== "fees_paid") return null;
    return previewFeesPaidForStudent(
      student,
      feesFrom,
      feesTo,
      feesIncludeSiblings,
      feesClaimFor,
    );
  }, [student, kind, feesFrom, feesTo, feesIncludeSiblings, feesClaimFor, tick]);

  const preview = useMemo(
    () => issues.find((i) => i.id === previewId) ?? null,
    [issues, previewId],
  );

  const voidTarget = useMemo(
    () => issues.find((i) => i.id === voidTargetId) ?? null,
    [issues, voidTargetId],
  );

  const nextCertNoPreview = useMemo(() => {
    if (!student) return "";
    const ay = student.academicYearCode || session.academicYearCode || DEFAULT_AY;
    return suggestNextCertificateNumber(kind, ay);
  }, [student, kind, session.academicYearCode]);

  async function onGenerateCertificateAi() {
    if (!student) {
      setError("Pick a student first");
      return;
    }
    setAiLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/student-certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          studentId: student.id,
          language: aiLanguage,
          purpose: aiPurpose || remarks,
          details: aiDetails,
          currentBody: customBody,
          mode: customBody ? "revise" : "create",
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        title?: string;
        body?: string;
        remarks?: string;
        tcSubjectsStudied?: string;
        tcGamesActivities?: string;
        tcAnnualExamResult?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error || "AI generation failed");
        return;
      }
      setCustomTitle(data.title || "");
      setCustomBody(data.body || "");
      setCustomIsAi(true);
      if (data.remarks) setRemarks(data.remarks);
      if (kind === "tc") {
        setTcForm((prev) => ({
          ...prev,
          subjectsStudied: data.tcSubjectsStudied || prev.subjectsStudied,
          gamesActivities: data.tcGamesActivities || prev.gamesActivities,
          annualExamResult: data.tcAnnualExamResult || prev.annualExamResult,
        }));
      }
      flash("AI certificate text ready — review before issue");
    } catch {
      setError("Network error — try again");
    } finally {
      setAiLoading(false);
    }
  }

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function onIssue() {
    if (!student) {
      setError("Pick a student first");
      return;
    }
    const mastersNow = masters ?? loadMasters();
    const ay = session.academicYearCode || DEFAULT_AY;
    const classTeacherName = resolveClassTeacherName(
      mastersNow,
      student.classId,
      student.sectionId,
      student.academicYearCode || ay,
    );
    const principal = resolvePrincipal(mastersNow);
    const issuedBy = principal?.fullName || session.fullName;
    const result = issueCertificate({
      kind,
      studentId: student.id,
      issuedBy,
      classTeacherName,
      issuedOn,
      admissionDate,
      leavingDate: kind === "tc" ? leavingDate : "",
      reasonForLeaving: kind === "tc" ? reasonForLeaving : "",
      lastClassStudied:
        kind === "tc" ? lastClassStudied : classLabelForStudent(student),
      promotedTo: kind === "tc" ? promotedTo : "",
      conduct,
      remarks,
      customTitle: customBody ? customTitle : undefined,
      customBody: customBody || undefined,
      aiGenerated: customBody ? customIsAi : undefined,
      inactivateOnTc,
      pen,
      apaarId,
      feesPaidPeriodFrom: kind === "fees_paid" ? feesFrom : undefined,
      feesPaidPeriodTo: kind === "fees_paid" ? feesTo : undefined,
      feesPaidClaimFor: kind === "fees_paid" ? feesClaimFor : undefined,
      feesPaidIncludeSiblings:
        kind === "fees_paid" ? feesIncludeSiblings : undefined,
      tc:
        kind === "tc"
          ? {
              ...tcForm,
              lastClassFigures: lastClassStudied || tcForm.lastClassFigures,
              lastClassWords: classToWords(
                lastClassStudied || tcForm.lastClassFigures,
              ),
              promotedToFigures: promotedTo || tcForm.promotedToFigures,
              promotedToWords: promotedTo
                ? classToWords(promotedTo)
                : tcForm.promotedToWords,
              applicationDate: tcForm.applicationDate || leavingDate,
              qualifiedForPromotion: promotedTo
                ? "Yes"
                : tcForm.qualifiedForPromotion,
            }
          : undefined,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flash(
      `Issued ${result.issue.certNo}${
        result.issue.inactivatedStudent ? " · student marked inactive" : ""
      }`,
    );
    setRemarks("");
    setReasonForLeaving("");
    setCustomTitle("");
    setCustomBody("");
    setCustomIsAi(false);
    refresh();
    setPreviewId(result.issue.id);
    window.setTimeout(() => printCertificate(result.issue.id), 200);
  }

  return (
    <ErpWorkspaceShell
      title="Certificates"
      subtitle="Issue TC, bonafide, character, fee clearance, and fees-paid certificates for reimbursement — open dues gate TC / no-dues."
      icon={<Award className="size-6" aria-hidden />}
      error={error}
      notice={notice}
      actions={
        <p className="text-[11px] text-[var(--muted)]">
          Officer: {session.fullName} · Session{" "}
          {session.academicYearCode || DEFAULT_AY}
        </p>
      }
    >
      <ModuleTabs
        aria-label="Certificates sections"
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        items={[
          { id: "dashboard", label: "Dashboard", tone: "navy" },
          { id: "desk", label: "Issue & register", tone: "amber" },
          { id: "reports", label: "Reports", tone: "teal" },
        ]}
      />

      {tab === "dashboard" ? (
        <div className="mt-6">
          <ModuleDashboardHost
            moduleId="certificates"
            onNavigateTab={(t) => setTab(t as Tab)}
          />
        </div>
      ) : null}

      {tab === "reports" ? (
        <div className="mt-6">
          <CertificatesReportsRunner />
        </div>
      ) : null}

      {tab === "desk" ? (
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Issue certificate
            </h2>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Find student
                </span>
                <input
                  className="field"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(null);
                  }}
                  placeholder="Name, admission no, or mobile…"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Class
                </span>
                <select
                  className="field !py-1.5"
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setSectionId("");
                    setSelected(null);
                  }}
                >
                  <option value="">All classes</option>
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Section
                </span>
                <select
                  className="field !py-1.5"
                  value={sectionId}
                  disabled={!classId}
                  onChange={(e) => {
                    setSectionId(e.target.value);
                    setSelected(null);
                  }}
                >
                  <option value="">
                    {classId ? "All sections" : "Pick class first"}
                  </option>
                  {sectionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-2 flex justify-end">
              <StudentHitsFilterExport
                title="Certificates · student search"
                hits={hits}
                query={query}
                classLabel={classOptions.find((c) => c.id === classId)?.name}
                sectionLabel={sectionOptions.find((s) => s.id === sectionId)?.name}
                onMessage={(msg) => {
                  setNotice(msg);
                  window.setTimeout(() => setNotice(null), 2200);
                }}
              />
            </div>

            {!selected && (query.trim() || classId || sectionId) ? (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {hits.length === 0 ? (
                  <li className="rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-3 text-sm text-[var(--muted)]">
                    No students match.
                  </li>
                ) : (
                  hits.slice(0, 12).map((h) => (
                  <li key={h.student.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border border-[rgba(32,48,80,0.12)] px-3 py-2 text-left hover:border-[rgba(197,160,40,0.45)] hover:bg-[rgba(197,160,40,0.08)]"
                      onClick={() => {
                        setSelected(h);
                        setQuery(h.student.fullName);
                      }}
                    >
                      <div className="text-sm font-semibold text-[var(--brand-deep)]">
                        <StudentNameLabel student={h.student} />
                        {h.student.status !== "active" ? (
                          <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">
                            (inactive)
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {h.classLabel} · open dues {formatInr(h.balancePaise)}
                      </div>
                    </button>
                  </li>
                  ))
                )}
              </ul>
            ) : null}

            {selected && student ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2">
                <div className="text-sm text-[var(--brand-deep)]">
                  <span className="font-semibold">{student.fullName}</span>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {student.admissionNo} · {selected.classLabel}
                    {resolvedClassTeacher
                      ? ` · Class teacher: ${resolvedClassTeacher}`
                      : ""}
                  </span>
                  <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                    PEN {student.pen || "not on file"} · APAAR{" "}
                    {student.apaarId || "not on file"}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--brand-mid)]"
                  onClick={() => {
                    setSelected(null);
                    setQuery("");
                  }}
                >
                  Change
                </button>
              </div>
            ) : null}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  PEN (UDISE+)
                </span>
                <input
                  className="field !py-1.5 font-mono"
                  value={pen}
                  onChange={(e) => setPen(e.target.value.trim())}
                  placeholder="Permanent Education Number"
                  disabled={!student}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  APAAR ID
                </span>
                <input
                  className="field !py-1.5 font-mono"
                  value={apaarId}
                  onChange={(e) => setApaarId(e.target.value.trim())}
                  placeholder="APAAR ID"
                  disabled={!student}
                />
              </label>
            </div>
            {student && (!pen || !apaarId) ? (
              <p className="mt-1.5 text-[11px] text-[#b45309]">
                {!pen && !apaarId
                  ? "PEN and APAAR ID missing on SIS — enter before issue if available (required for UDISE+ / DigiLocker flows)."
                  : !pen
                    ? "PEN missing — enter if registered on UDISE+."
                    : "APAAR ID missing — enter if issued."}
              </p>
            ) : null}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Certificate type
                </span>
                <select
                  className="field !py-1.5"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as CertificateKind);
                  }}
                >
                  {CERTIFICATE_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              {student && nextCertNoPreview ? (
                <p className="text-[11px] text-[var(--muted)] sm:col-span-2">
                  Next certificate no. (from Masters numbering):{" "}
                  <strong className="text-[var(--brand-deep)]">
                    {nextCertNoPreview}
                  </strong>
                </p>
              ) : null}
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Issue date
                </span>
                <input
                  className="field !py-1.5"
                  type="date"
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Conduct
                </span>
                <input
                  className="field !py-1.5"
                  value={conduct}
                  onChange={(e) => setConduct(e.target.value)}
                  placeholder="Good"
                />
              </label>
            </div>

            {kind === "fees_paid" ? (
              <div className="mt-3 space-y-3 rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.02)] p-3">
                <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                  Fees paid — reimbursement certificate
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Period from
                    </span>
                    <input
                      className="field !py-1.5"
                      type="date"
                      value={feesFrom}
                      onChange={(e) => setFeesFrom(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Period to
                    </span>
                    <input
                      className="field !py-1.5"
                      type="date"
                      value={feesTo}
                      onChange={(e) => setFeesTo(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Claim / employer purpose
                    </span>
                    <input
                      className="field !py-1.5"
                      value={feesClaimFor}
                      onChange={(e) => setFeesClaimFor(e.target.value)}
                      placeholder="e.g. Employer name · children education reimbursement"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={feesIncludeSiblings}
                      onChange={(e) =>
                        setFeesIncludeSiblings(e.target.checked)
                      }
                    />
                    <span className="text-[var(--brand-deep)]">
                      Include fees paid for household siblings in the same
                      period
                    </span>
                  </label>
                </div>
                {feesPaidPreview ? (
                  "error" in feesPaidPreview ? (
                    <p className="text-[11px] font-semibold text-[#dc2626]">
                      {feesPaidPreview.error}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[var(--brand-deep)]">
                      Preview:{" "}
                      <span className="font-bold">
                        {formatInr(feesPaidPreview.totalPaidPaise)}
                      </span>{" "}
                      across {feesPaidPreview.receipts.length} receipt
                      {feesPaidPreview.receipts.length === 1 ? "" : "s"}
                    </p>
                  )
                ) : null}
              </div>
            ) : null}

            {kind === "tc" ? (
              <div className="mt-3 space-y-3 rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.02)] p-3">
                <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                  CBSE Annexure-I fields
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Book No.
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.bookNo}
                      onChange={(e) => patchTc({ bookNo: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Date of first admission *
                    </span>
                    <input
                      className="field !py-1.5"
                      type="date"
                      value={admissionDate}
                      onChange={(e) => setAdmissionDate(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Class at first admission
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.admissionClass}
                      onChange={(e) =>
                        patchTc({ admissionClass: e.target.value })
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Leaving / struck-off date *
                    </span>
                    <input
                      className="field !py-1.5"
                      type="date"
                      value={leavingDate}
                      onChange={(e) => {
                        setLeavingDate(e.target.value);
                        patchTc({ applicationDate: e.target.value });
                      }}
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Reason for leaving *
                    </span>
                    <input
                      className="field !py-1.5"
                      value={reasonForLeaving}
                      onChange={(e) => setReasonForLeaving(e.target.value)}
                      placeholder="e.g. Parent transfer / change of school"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Last class studied (figures)
                    </span>
                    <input
                      className="field !py-1.5"
                      value={lastClassStudied}
                      onChange={(e) => {
                        setLastClassStudied(e.target.value);
                        patchTc({
                          lastClassFigures: e.target.value,
                          lastClassWords: classToWords(e.target.value),
                          subjectsStudied: defaultSubjectsForClass(
                            e.target.value,
                          ),
                        });
                      }}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Promoted / eligible for (figures)
                    </span>
                    <input
                      className="field !py-1.5"
                      value={promotedTo}
                      onChange={(e) => setPromotedTo(e.target.value)}
                      placeholder="e.g. IV-A"
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      School / Board annual exam last taken with result
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.annualExamResult}
                      onChange={(e) =>
                        patchTc({ annualExamResult: e.target.value })
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Whether failed (once / twice)
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.failedOnceTwice}
                      onChange={(e) =>
                        patchTc({ failedOnceTwice: e.target.value })
                      }
                      placeholder="No"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Qualified for promotion
                    </span>
                    <select
                      className="field !py-1.5"
                      value={tcForm.qualifiedForPromotion}
                      onChange={(e) =>
                        patchTc({ qualifiedForPromotion: e.target.value })
                      }
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                      <option value="N/A — mid-session">
                        N/A — mid-session
                      </option>
                    </select>
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Subjects studied
                    </span>
                    <textarea
                      className="field min-h-[4rem] !py-1.5"
                      value={tcForm.subjectsStudied}
                      onChange={(e) =>
                        patchTc({ subjectsStudied: e.target.value })
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Nationality
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.nationality}
                      onChange={(e) =>
                        patchTc({ nationality: e.target.value })
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      SC / ST / OBC
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.category}
                      onChange={(e) => patchTc({ category: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Dues paid up to (month)
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.duesPaidUpto}
                      onChange={(e) =>
                        patchTc({ duesPaidUpto: e.target.value })
                      }
                      placeholder="Auto if cleared"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Fee concession
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.feeConcession}
                      onChange={(e) =>
                        patchTc({ feeConcession: e.target.value })
                      }
                      placeholder="No"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Working days (session)
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.workingDays}
                      onChange={(e) =>
                        patchTc({ workingDays: e.target.value })
                      }
                      placeholder="e.g. 220"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Days present
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.daysPresent}
                      onChange={(e) =>
                        patchTc({ daysPresent: e.target.value })
                      }
                      placeholder="e.g. 205"
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      NCC / Scout / Guide
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.nccScoutGuide}
                      onChange={(e) =>
                        patchTc({ nccScoutGuide: e.target.value })
                      }
                      placeholder="No"
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Games / extra-curricular (with achievement)
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.gamesActivities}
                      onChange={(e) =>
                        patchTc({ gamesActivities: e.target.value })
                      }
                      placeholder="e.g. Cricket, school athletic meet"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Date of application
                    </span>
                    <input
                      className="field !py-1.5"
                      type="date"
                      value={tcForm.applicationDate}
                      onChange={(e) =>
                        patchTc({ applicationDate: e.target.value })
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Checked by (name)
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.checkedByName}
                      onChange={(e) =>
                        patchTc({ checkedByName: e.target.value })
                      }
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Checked by (designation)
                    </span>
                    <input
                      className="field !py-1.5"
                      value={tcForm.checkedByDesignation}
                      onChange={(e) =>
                        patchTc({ checkedByDesignation: e.target.value })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={inactivateOnTc}
                      onChange={(e) => setInactivateOnTc(e.target.checked)}
                    />
                    <span className="text-[var(--brand-deep)]">
                      Mark student inactive after TC (name struck off rolls)
                    </span>
                  </label>
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.02)] p-3">
              <h3 className="text-xs font-bold text-[var(--brand-deep)]">
                Draft with AI (CBSE + UP Basic Education)
              </h3>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Generates certificate text per CBSE affiliation norms and UP
                Basic Shiksha guidelines — English, Hindi, or both.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  Language
                  <select
                    className="field mt-1 !py-1.5 text-xs"
                    value={aiLanguage}
                    onChange={(e) =>
                      setAiLanguage(e.target.value as "en" | "hi" | "both")
                    }
                  >
                    <option value="en">English</option>
                    <option value="hi">Hindi</option>
                    <option value="both">English + Hindi</option>
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  Purpose
                  <input
                    className="field mt-1 !py-1.5 text-xs"
                    value={aiPurpose}
                    onChange={(e) => setAiPurpose(e.target.value)}
                    placeholder="Bank, visa, employer, transfer…"
                  />
                </label>
              </div>
              <label className="mt-2 block text-[11px] font-semibold text-[var(--muted)]">
                Extra details for AI
                <textarea
                  className="field mt-1 min-h-[60px] !py-1.5 text-xs"
                  value={aiDetails}
                  onChange={(e) => setAiDetails(e.target.value)}
                  placeholder="Special clauses, board exam year, scholarship name…"
                />
              </label>
              <button
                type="button"
                className="mt-2 rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                disabled={aiLoading || !student}
                onClick={() => void onGenerateCertificateAi()}
              >
                <Sparkles className="mr-1 inline h-3.5 w-3.5" />
                {aiLoading ? "Generating…" : "Generate certificate (AI)"}
              </button>
              {customBody ? (
                <label className="mt-3 block text-[11px] font-semibold text-[var(--muted)]">
                  AI certificate text (edit before issue)
                  <textarea
                    className="field mt-1 min-h-[120px] !py-2 text-xs leading-relaxed"
                    value={customBody}
                    onChange={(e) => setCustomBody(e.target.value)}
                  />
                </label>
              ) : null}
            </div>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Remarks / purpose (optional)
              </span>
              <input
                className="field !py-1.5"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={
                  kind === "bonafide"
                    ? "e.g. Bank account / visa"
                    : kind === "fees_paid"
                      ? "Optional note on certificate"
                      : "Optional remarks"
                }
              />
            </label>

            {eligibility ? (
              <div className="mt-3 space-y-1.5 rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-3 py-2 text-[11px]">
                <p className="text-[var(--brand-deep)]">
                  Open dues:{" "}
                  <span className="font-bold">
                    {formatInr(eligibility.openBalancePaise)}
                  </span>{" "}
                  ({eligibility.openDueCount} line
                  {eligibility.openDueCount === 1 ? "" : "s"})
                </p>
                {eligibility.blockers.map((b) => (
                  <p key={b} className="font-semibold text-[#dc2626]">
                    {b}
                  </p>
                ))}
                {eligibility.warnings.map((w) => (
                  <p key={w} className="text-[#b45309]">
                    {w}
                  </p>
                ))}
                {eligibility.requiresOverride ? (
                  <button
                    type="button"
                    className="mt-1 rounded-md bg-white px-2 py-1 text-[11px] font-bold text-[var(--brand-deep)]"
                    onClick={() => setHoldDialog(true)}
                  >
                    Unlock with Principal PIN
                  </button>
                ) : null}
                <HoldStatusBanner
                  check={holdCheck}
                  onOverride={() => setHoldDialog(true)}
                />
              </div>
            ) : null}

            <button
              type="button"
              className="btn-accent mt-4 rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-50"
              disabled={
                !student ||
                (eligibility && !eligibility.canIssue) ||
                (kind === "fees_paid" &&
                  (!!feesPaidPreview && "error" in feesPaidPreview))
              }
              onClick={onIssue}
            >
              Issue & print
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Recent issues
            </h2>
            {issues.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">
                No certificates issued yet.
              </p>
            ) : (
              <ErpTableShell className="mt-2">
                <ul className="max-h-72 divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto">
                {issues.slice(0, 25).map((iss) => {
                  const voided = !!iss.voidedAt;
                  return (
                    <li
                      key={iss.id}
                      className={`flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 ${
                        voided ? "opacity-55" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setPreviewId(iss.id)}
                      >
                        <div className="text-sm font-semibold text-[var(--brand-deep)]">
                          {iss.certNo}
                          {voided ? " · void" : ""}
                          {iss.aiGenerated ? (
                            <span
                              className="ml-1.5 rounded-full bg-[rgba(197,160,40,0.15)] px-1.5 py-0.5 text-[9px] font-semibold text-[#8a6400]"
                              title="Initial text drafted by the AI assistant, reviewed before issue — internal note, never printed on the certificate"
                            >
                              AI-drafted
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {certificateKindLabel(iss.kind)} · {iss.studentName} ·{" "}
                          {formatCertDate(iss.issuedOn)}
                        </div>
                      </button>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[var(--brand-mid)]"
                          onClick={() => {
                            setPreviewId(iss.id);
                            window.setTimeout(
                              () => printCertificate(iss.id),
                              100,
                            );
                          }}
                        >
                          Print
                        </button>
                        {!voided ? (
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-[var(--danger)]"
                            onClick={() => setVoidTargetId(iss.id)}
                          >
                            Void
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                </ul>
              </ErpTableShell>
            )}
          </div>

          {preview ? (
            <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] p-3">
              <div className="mb-2 flex items-center justify-between gap-2 print-hide">
                <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                  Preview
                </h2>
                <button
                  type="button"
                  className="btn-accent rounded-lg px-3 py-1.5 text-xs font-bold"
                  onClick={() => printCertificate(preview.id)}
                >
                  Print
                </button>
              </div>
              <CertificateSheet issue={preview} />
            </div>
          ) : null}
        </div>
      </div>
      ) : null}

      {holdDialog &&
      student &&
      holdCheck &&
      !holdCheck.allowed ? (
        <PrincipalHoldOverrideDialog
          studentId={student.id}
          studentName={student.fullName}
          holdCode={holdCode}
          block={holdCheck}
          overriddenBy={session.fullName}
          onClose={() => setHoldDialog(false)}
          onGranted={() => {
            setHoldDialog(false);
            setTick((t) => t + 1);
            flash("Hold unlocked — you can issue the certificate now");
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!voidTarget}
        onOpenChange={(open) => {
          if (!open) setVoidTargetId(null);
        }}
        title={
          voidTarget
            ? `Void ${voidTarget.certNo}?`
            : "Void this certificate?"
        }
        description="Student status is not restored."
        confirmLabel="Void"
        tone="danger"
        onConfirm={() => {
          if (!voidTarget) return;
          voidCertificate(voidTarget.id);
          refresh();
          flash("Certificate voided");
          setVoidTargetId(null);
        }}
      />
    </ErpWorkspaceShell>
  );
}
