"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DOC_LABELS,
  countDocsWithFiles,
  displayAadhaar,
  householdOf,
  profileCompleteness,
  siblingsOf,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import type { MastersState } from "@/lib/masters";
import {
  StudentAvatar,
  StudentNameLabel,
} from "@/components/students/StudentAvatar";
import {
  computeStudentDues,
  loadFees,
  type FeeDueLine,
  type FeesState,
} from "@/lib/fees";
import {
  buildReportCard,
  listAllExamTerms,
  loadExams,
  type ExamsState,
  type ReportCard,
} from "@/lib/exams";
import {
  ATTENDANCE_STATUSES,
  loadAttendance,
  type AttendanceState,
  type AttendanceStatus,
} from "@/lib/attendance";

type ProfileTab =
  | "profile"
  | "fees"
  | "exams"
  | "attendance"
  | "documents"
  | "siblings";

const TABS: { id: ProfileTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "fees", label: "Fees" },
  { id: "exams", label: "Exams" },
  { id: "attendance", label: "Attendance" },
  { id: "documents", label: "Documents" },
  { id: "siblings", label: "Siblings" },
];

function inr(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

export function StudentProfileModal({
  student,
  sis,
  masters,
  classLabel,
  feeGroupLabel,
  onClose,
  onOpenStudent,
}: {
  student: SisStudent;
  sis: SisState;
  masters: MastersState;
  classLabel: string;
  feeGroupLabel: string;
  onClose: () => void;
  onOpenStudent: (id: string) => void;
}) {
  const [tab, setTab] = useState<ProfileTab>("profile");
  const [fees, setFees] = useState<FeesState | null>(null);
  const [exams, setExams] = useState<ExamsState | null>(null);
  const [attendance, setAttendance] = useState<AttendanceState | null>(null);

  useEffect(() => {
    try {
      setFees(loadFees());
    } catch {
      setFees(null);
    }
    try {
      setExams(loadExams());
    } catch {
      setExams(null);
    }
    try {
      setAttendance(loadAttendance());
    } catch {
      setAttendance(null);
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hh = householdOf(sis, student.householdId);
  const sibs = siblingsOf(sis, student);
  const pct = profileCompleteness(student, hh);
  const ay = student.academicYearCode || "";

  const feeSummary = useMemo(() => {
    if (!fees)
      return { lines: [] as FeeDueLine[], billed: 0, paid: 0, balance: 0 };
    const lines = computeStudentDues(student, masters, fees, {
      includePaid: true,
      includeInactive: true,
    });
    let billed = 0;
    let paid = 0;
    let balance = 0;
    for (const l of lines) {
      billed += l.billedPaise - l.concessionPaise;
      paid += l.paidPaise;
      balance += l.balancePaise;
    }
    return { lines, billed, paid, balance };
  }, [fees, student, masters]);

  const examCards = useMemo(() => {
    if (!exams) return [] as ReportCard[];
    const terms = listAllExamTerms(ay, exams);
    const cards: ReportCard[] = [];
    for (const term of terms) {
      const rc = buildReportCard({
        student,
        classLabel,
        examTermId: term.id,
        academicYearCode: ay,
      });
      if ("error" in rc) continue;
      const hasMarks = rc.lines.some((l) => l.marksObtained != null);
      if (hasMarks) cards.push(rc);
    }
    return cards;
  }, [exams, student, classLabel, ay]);

  const attendanceSummary = useMemo(() => {
    if (!attendance)
      return {
        working: 0,
        present: 0,
        percent: 0,
        counts: {} as Record<AttendanceStatus, number>,
      };
    const counts: Record<AttendanceStatus, number> = {
      P: 0,
      A: 0,
      L: 0,
      HD: 0,
      LE: 0,
    };
    let working = 0;
    let present = 0;
    for (const reg of attendance.registers) {
      if (ay && reg.academicYearCode !== ay) continue;
      const mark = reg.marks.find((m) => m.studentId === student.id);
      if (!mark) continue;
      working += 1;
      counts[mark.status] = (counts[mark.status] || 0) + 1;
      if (mark.status === "P" || mark.status === "L") present += 1;
      else if (mark.status === "HD") present += 0.5;
    }
    return {
      working,
      present,
      percent: working ? Math.round((present / working) * 1000) / 10 : 0,
      counts,
    };
  }, [attendance, student.id, ay]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(12,18,32,0.55)] p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 border-b border-[rgba(32,48,80,0.1)] p-5">
          <StudentAvatar student={student} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-lg font-semibold text-[var(--brand-deep)]">
              <StudentNameLabel student={student} sis={sis} />
              {student.status !== "active" ? (
                <span className="rounded bg-[rgba(32,48,80,0.08)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
                  inactive
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-xs text-[var(--muted)]">
              {student.admissionNo} · {classLabel}
              {student.rollNo ? ` · Roll ${student.rollNo}` : ""}
              {ay ? ` · ${ay}` : ""}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-[rgba(32,48,80,0.08)]">
                <div
                  className="h-full rounded-full bg-[var(--brand-gold)]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] text-[var(--muted)]">
                Profile {pct}% complete
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-lg leading-none text-[var(--muted)] hover:bg-[rgba(32,48,80,0.06)]"
            >
              ✕
            </button>
            <Link
              href={`/students/${student.id}/edit`}
              className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--brand-mid)]"
            >
              Edit
            </Link>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-[rgba(32,48,80,0.1)] px-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap px-3 py-2.5 text-sm font-semibold ${
                tab === t.id
                  ? "border-b-2 border-[var(--brand-deep)] text-[var(--brand-deep)]"
                  : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-5">
          {tab === "profile" ? (
            <div className="space-y-5">
              <Section title="Student">
                <Field label="Full name" value={student.fullName} />
                <Field label="Admission no" value={student.admissionNo} />
                <Field label="Class / section" value={classLabel} />
                <Field label="Roll no" value={student.rollNo || "—"} />
                <Field
                  label="Gender"
                  value={
                    student.gender === "M"
                      ? "Male"
                      : student.gender === "F"
                        ? "Female"
                        : student.gender === "O"
                          ? "Other"
                          : "—"
                  }
                />
                <Field label="Date of birth" value={student.dob || "—"} />
                <Field label="Category" value={student.category || "—"} />
                <Field label="Caste" value={student.caste || "—"} />
                <Field label="Religion" value={student.religion || "—"} />
                <Field label="Blood group" value={student.bloodGroup || "—"} />
                <Field label="Fee group" value={feeGroupLabel} />
                {student.heightCm || student.weightKg ? (
                  <Field
                    label="Height / weight"
                    value={`${student.heightCm ? `${student.heightCm} cm` : "—"} · ${
                      student.weightKg ? `${student.weightKg} kg` : "—"
                    }`}
                  />
                ) : null}
                {student.isCwsn ? (
                  <Field
                    label="Special needs (CWSN)"
                    value={student.disabilityDetails || "Yes"}
                  />
                ) : null}
                {student.medicalNotes ? (
                  <Field label="Medical" value={student.medicalNotes} full />
                ) : null}
                {student.secondLanguage || student.thirdLanguage ? (
                  <Field
                    label="Languages (2nd / 3rd)"
                    value={[student.secondLanguage, student.thirdLanguage]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ) : null}
                {student.hobbies ? (
                  <Field label="Hobbies" value={student.hobbies} full />
                ) : null}
              </Section>

              <Section title="Compliance IDs">
                <Field label="PEN" value={student.pen || student.penStatus || "—"} />
                <Field label="APAAR" value={student.apaarId || "—"} />
                <Field label="SRN" value={student.srn || "—"} />
                <Field
                  label="Aadhaar"
                  value={
                    student.aadhaarNumber || student.aadhaarLast4
                      ? `${displayAadhaar({
                          number: student.aadhaarNumber,
                          last4: student.aadhaarLast4,
                          verification: student.aadhaarVerification,
                        })}${
                          student.aadhaarVerification === "verified_udise"
                            ? " · UDISE verified"
                            : student.aadhaarVerification === "received"
                              ? " · received"
                              : ""
                        }`
                      : "—"
                  }
                />
              </Section>

              <Section title="Parents & guardian">
                <Field label="Father" value={student.fatherName || "—"} />
                <Field label="Father mobile" value={student.fatherMobile || "—"} />
                {student.fatherOccupation || student.fatherQualification ? (
                  <Field
                    label="Father work / qualification"
                    value={[student.fatherOccupation, student.fatherQualification]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ) : null}
                <Field label="Mother" value={student.motherName || "—"} />
                <Field label="Mother mobile" value={student.motherMobile || "—"} />
                {student.motherOccupation || student.motherQualification ? (
                  <Field
                    label="Mother work / qualification"
                    value={[student.motherOccupation, student.motherQualification]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ) : null}
                {student.annualIncome ? (
                  <Field label="Family income / year" value={`₹${student.annualIncome}`} />
                ) : null}
                <Field
                  label="Guardian"
                  value={hh?.guardianName || "—"}
                />
                <Field label="Guardian mobile" value={hh?.mobile || "—"} />
                <Field
                  label="WhatsApp"
                  value={hh?.whatsappMobile || hh?.mobile || "—"}
                />
                <Field label="Email" value={hh?.email || "—"} />
              </Section>

              <Section title="Address">
                <Field
                  label="Address"
                  value={hh?.address || "—"}
                  full
                />
                <Field label="Locality" value={hh?.locality || "—"} />
                <Field label="City" value={hh?.city || "—"} />
                <Field label="State" value={hh?.state || "—"} />
                <Field label="Pincode" value={hh?.pincode || "—"} />
                {student.permanentAddress ? (
                  <Field
                    label="Permanent address"
                    value={[
                      student.permanentAddress,
                      student.permanentCity,
                      student.permanentState,
                      student.permanentPincode,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    full
                  />
                ) : null}
              </Section>

              {student.registrationNo ||
              student.admissionFormNo ||
              student.admissionClass ||
              student.tcNo ||
              student.transportRoute ||
              student.previousSchool ? (
                <Section title="Admission & records">
                  <Field
                    label="Registration no"
                    value={student.registrationNo || "—"}
                  />
                  <Field
                    label="Admission form no"
                    value={student.admissionFormNo || "—"}
                  />
                  <Field
                    label="Admission class"
                    value={student.admissionClass || "—"}
                  />
                  <Field label="TC no (issued)" value={student.tcNo || "—"} />
                  <Field
                    label="Transport route"
                    value={student.transportRoute || "—"}
                  />
                  <Field
                    label="Previous school"
                    value={
                      [
                        student.previousSchool,
                        student.previousSchoolClass,
                        student.previousSchoolYear,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"
                    }
                    full
                  />
                </Section>
              ) : null}
            </div>
          ) : null}

          {tab === "fees" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Billed" value={inr(feeSummary.billed)} />
                <Stat label="Paid" value={inr(feeSummary.paid)} tone="green" />
                <Stat
                  label="Outstanding"
                  value={inr(feeSummary.balance)}
                  tone={feeSummary.balance > 0 ? "coral" : "green"}
                />
              </div>
              {feeSummary.lines.length === 0 ? (
                <Empty text="No fee dues found for this student." />
              ) : (
                <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[rgba(32,48,80,0.04)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-2">Head</th>
                        <th className="px-3 py-2">Due on</th>
                        <th className="px-3 py-2 text-right">Billed</th>
                        <th className="px-3 py-2 text-right">Paid</th>
                        <th className="px-3 py-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(32,48,80,0.08)]">
                      {feeSummary.lines.map((l) => (
                        <tr key={l.dueKey}>
                          <td className="px-3 py-2 text-[var(--brand-deep)]">
                            {l.label || l.feeHeadName}
                          </td>
                          <td className="px-3 py-2 text-[var(--muted)]">
                            {l.dueOn || "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {inr(l.billedPaise - l.concessionPaise)}
                          </td>
                          <td className="px-3 py-2 text-right text-[#0f766e]">
                            {inr(l.paidPaise)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-semibold ${
                              l.balancePaise > 0
                                ? "text-[#c0392b]"
                                : "text-[#0f766e]"
                            }`}
                          >
                            {inr(l.balancePaise)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === "exams" ? (
            <div className="space-y-4">
              {examCards.length === 0 ? (
                <Empty text="No exam marks recorded for this session yet." />
              ) : (
                examCards.map((rc) => (
                  <div
                    key={rc.examTerm.id}
                    className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)]"
                  >
                    <div className="flex items-center justify-between bg-[rgba(32,48,80,0.04)] px-3 py-2">
                      <span className="text-sm font-semibold text-[var(--brand-deep)]">
                        {rc.examTerm.label}
                      </span>
                      <span className="text-xs font-semibold text-[var(--brand-mid)]">
                        {rc.totalObtained}/{rc.totalMax} · {rc.percent}% ·{" "}
                        {rc.overallGrade || "—"}
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-[rgba(32,48,80,0.08)]">
                        {rc.lines.map((l) => (
                          <tr key={l.subjectId}>
                            <td className="px-3 py-2 text-[var(--brand-deep)]">
                              {l.subjectName}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--muted)]">
                              {l.marksObtained == null
                                ? "—"
                                : `${l.marksObtained}/${l.maxMarks}`}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-[var(--brand-mid)]">
                              {l.grade || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === "attendance" ? (
            <div className="space-y-4">
              {attendanceSummary.working === 0 ? (
                <Empty text="No attendance marked for this student yet." />
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <Stat
                      label="Present"
                      value={String(attendanceSummary.present)}
                      tone="green"
                    />
                    <Stat
                      label="Working days"
                      value={String(attendanceSummary.working)}
                    />
                    <Stat
                      label="Attendance %"
                      value={`${attendanceSummary.percent}%`}
                      tone={attendanceSummary.percent >= 75 ? "green" : "coral"}
                    />
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {ATTENDANCE_STATUSES.map((s) => (
                      <div
                        key={s.code}
                        className="rounded-lg border border-[rgba(32,48,80,0.12)] px-2 py-2 text-center"
                      >
                        <div className="text-lg font-semibold text-[var(--brand-deep)]">
                          {attendanceSummary.counts[s.code] || 0}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                          {s.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {tab === "documents" ? (
            <div className="space-y-3">
              <p className="text-xs text-[var(--muted)]">
                {countDocsWithFiles(student.docs)} of {DOC_LABELS.length} documents
                on file
              </p>
              <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)]">
                <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                  {DOC_LABELS.map((d) => {
                    const file = student.docs?.[d.key];
                    const has = file && file.fileUrl;
                    return (
                      <li
                        key={d.key}
                        className="flex items-center justify-between px-3 py-2.5 text-sm"
                      >
                        <span className="text-[var(--brand-deep)]">{d.label}</span>
                        {has ? (
                          <a
                            href={file.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-[var(--brand-mid)]"
                          >
                            View file
                          </a>
                        ) : (
                          <span className="text-xs font-medium text-[var(--muted)]">
                            Missing
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : null}

          {tab === "siblings" ? (
            <div className="space-y-3">
              {sibs.length === 0 ? (
                <Empty text="No siblings on this household." />
              ) : (
                <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)]">
                  <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                    {sibs.map((sib) => (
                      <li key={sib.id}>
                        <button
                          type="button"
                          onClick={() => onOpenStudent(sib.id)}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[rgba(197,160,40,0.1)]"
                        >
                          <StudentAvatar student={sib} size={36} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[var(--brand-deep)]">
                              {sib.fullName}
                            </div>
                            <div className="text-xs text-[var(--muted)]">
                              {sib.admissionNo}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </h4>
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function Field({
  label,
  value,
  full,
}: {
  label: string;
  value: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-[var(--brand-deep)]">
        {value}
      </dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "coral";
}) {
  const color =
    tone === "green"
      ? "text-[#0f766e]"
      : tone === "coral"
        ? "text-[#c0392b]"
        : "text-[var(--brand-deep)]";
  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-3 py-3">
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-[rgba(32,48,80,0.02)] px-4 py-8 text-center text-sm text-[var(--muted)]">
      {text}
    </div>
  );
}
