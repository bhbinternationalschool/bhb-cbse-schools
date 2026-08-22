"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import {
  BLOOD_GROUPS,
  STUDENT_CATEGORIES,
  householdOf,
  loadSis,
  studentTypeShort,
  type SisState,
  type SisStudent,
  type StudentCategory,
} from "@/lib/sis";
import {
  bulkUploadParentImages,
  bulkUploadStudentImages,
  hasPortalPassword,
  portalUsernameOf,
  setParentPhoto,
  setStudentPhoto,
  updateStudentBiometric,
  updateStudentDetails,
  updateStudentLoginPassword,
} from "@/lib/studentUpdate";
import {
  StudentAvatar,
  StudentNameLabel,
} from "@/components/students/StudentAvatar";
import { InlinePhotoCapture } from "@/components/students/InlinePhotoCapture";
import { useDemoSession } from "@/components/shell/SessionContext";
import { normalizeSessionCode } from "@/lib/studentImport";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";

type UpdateTool =
  | "details"
  | "biometric"
  | "password"
  | "student_images"
  | "parent_images";

const TOOLS: { id: UpdateTool; label: string; hint: string }[] = [
  {
    id: "details",
    label: "Update details",
    hint: "Name, roll, parents, category…",
  },
  {
    id: "biometric",
    label: "Biometric / RFID",
    hint: "Card & device enrolment ids",
  },
  {
    id: "password",
    label: "Login password",
    hint: "Portal username & password",
  },
  {
    id: "student_images",
    label: "Student images",
    hint: "Class list · upload / camera",
  },
  {
    id: "parent_images",
    label: "Parent images",
    hint: "Class list · father / mother",
  },
];

function classLabel(s: SisStudent, masters: MastersState): string {
  const cls = masters.classes.find((c) => c.id === s.classId)?.name ?? "—";
  const sec = masters.sections.find((x) => x.id === s.sectionId)?.name ?? "";
  return sec ? `${cls}-${sec}` : cls;
}

function StudentPicker({
  sis,
  masters,
  selectedId,
  sessionCode,
  onSelect,
}: {
  sis: SisState;
  masters: MastersState;
  selectedId: string;
  /** The session shown in the header — searches are scoped to it by default. */
  sessionCode: string;
  onSelect: (s: SisStudent | null) => void;
}) {
  const [query, setQuery] = useState("");
  // Off by default. sis.students holds one row per student per session, so an
  // unscoped search returns the same child several times over and invites
  // editing last year's record while believing you are on this year's.
  const [allSessions, setAllSessions] = useState(false);
  const wantSession = normalizeSessionCode(sessionCode || "");

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = sis.students.filter((s) => s.status === "active");
    if (!allSessions && wantSession) {
      rows = rows.filter(
        (s) => normalizeSessionCode(s.academicYearCode || "") === wantSession,
      );
    }
    if (q) {
      rows = rows.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          s.rollNo.toLowerCase().includes(q) ||
          (s.rfidNo ?? "").toLowerCase().includes(q) ||
          portalUsernameOf(s).toLowerCase().includes(q),
      );
    }
    return rows
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, 10);
  }, [sis, query, allSessions, wantSession]);

  const selected = sis.students.find((s) => s.id === selectedId) ?? null;

  return (
    <div>
      <input
        className="field"
        placeholder="Search student…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {selected ? (
        <div className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-3 py-2">
          <div className="flex min-w-0 items-start gap-2">
            <StudentAvatar student={selected} size={40} />
            <div className="min-w-0">
              <div className="font-medium text-[var(--brand-deep)]">
                <StudentNameLabel student={selected} sis={sis} />
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                {selected.admissionNo} · {classLabel(selected, masters)} ·{" "}
                {studentTypeShort(selected.studentType).code}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="text-[11px] font-semibold text-[#b71c1c]"
            onClick={() => onSelect(null)}
          >
            Clear
          </button>
        </div>
      ) : null}
      {!selected ? (
        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <input
            type="checkbox"
            checked={allSessions}
            onChange={(e) => setAllSessions(e.target.checked)}
          />
          <span>
            Search other sessions too
            {!allSessions && wantSession ? ` (showing ${wantSession} only)` : ""}
          </span>
        </label>
      ) : null}
      {!selected && query.trim() ? (
        <ul className="mt-2 max-h-48 overflow-auto rounded-lg border border-[rgba(32,48,80,0.08)]">
          {hits.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[rgba(32,48,80,0.04)]"
                onClick={() => {
                  onSelect(s);
                  setQuery("");
                }}
              >
                <StudentAvatar student={s} size={32} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--brand-deep)]">
                    <StudentNameLabel student={s} sis={sis} />
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {s.admissionNo} · {classLabel(s, masters)}
                    {normalizeSessionCode(s.academicYearCode || "") !==
                    wantSession ? (
                      <span className="ml-1 rounded bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] px-1 font-bold text-[var(--danger)]">
                        {s.academicYearCode || "no session"}
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            </li>
          ))}
          {!hits.length ? (
            <li className="px-3 py-3 text-center text-xs text-[var(--muted)]">
              No match
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

export function StudentUpdatePanel({
  tick = 0,
  onChanged,
}: {
  tick?: number;
  onChanged?: (sis: SisState) => void;
}) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [tool, setTool] = useState<UpdateTool>("details");
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Details form
  const [fullName, setFullName] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [gender, setGender] = useState<SisStudent["gender"]>("");
  const [dob, setDob] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [fatherMobile, setFatherMobile] = useState("");
  const [motherMobile, setMotherMobile] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [category, setCategory] = useState<StudentCategory>("");
  const [religion, setReligion] = useState("");
  const [notes, setNotes] = useState("");

  // Biometric
  const [rfidNo, setRfidNo] = useState("");
  const [biometricId, setBiometricId] = useState("");

  // Password
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Bulk
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkLog, setBulkLog] = useState<string[]>([]);
  const studentImgRef = useRef<HTMLInputElement>(null);
  const parentImgRef = useRef<HTMLInputElement>(null);
  const [photoClassId, setPhotoClassId] = useState("");
  const [photoSectionId, setPhotoSectionId] = useState("");
  const [photoQuery, setPhotoQuery] = useState("");

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
  }

  useEffect(() => {
    refresh();
  }, [tick]);

  const selected = useMemo(() => {
    if (!sis || !selectedId) return null;
    return sis.students.find((s) => s.id === selectedId) ?? null;
  }, [sis, selectedId]);

  const photoSections = useMemo(() => {
    if (!masters || !photoClassId) return [];
    return masters.sections.filter(
      (s) => s.isActive && s.classId === photoClassId,
    );
  }, [masters, photoClassId]);

  const photoRoster = useMemo(() => {
    if (!sis || !masters || !photoClassId) return [] as SisStudent[];
    const wantSession = normalizeSessionCode(session.academicYearCode || "");
    let rows = sis.students.filter((s) => {
      if (s.status !== "active") return false;
      // Same reasoning as the picker: a class roster must not mix sessions.
      if (
        wantSession &&
        normalizeSessionCode(s.academicYearCode || "") !== wantSession
      ) {
        return false;
      }
      if (s.classId === photoClassId) return true;
      const sec = masters.sections.find((x) => x.id === s.sectionId);
      return sec?.classId === photoClassId;
    });
    if (photoSectionId) {
      rows = rows.filter((s) => s.sectionId === photoSectionId);
    }
    const q = photoQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          s.rollNo.toLowerCase().includes(q),
      );
    }
    return rows
      .slice()
      .sort((a, b) => {
        const sa = classLabel(a, masters);
        const sb = classLabel(b, masters);
        if (sa !== sb) return sa.localeCompare(sb);
        const ra = Number(a.rollNo) || 0;
        const rb = Number(b.rollNo) || 0;
        if (ra && rb && ra !== rb) return ra - rb;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [sis, masters, photoClassId, photoSectionId, photoQuery, session.academicYearCode]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3600);
  }

  function loadStudentFields(s: SisStudent) {
    setFullName(s.fullName);
    setRollNo(s.rollNo);
    setGender(s.gender);
    setDob(s.dob);
    setFatherName(s.fatherName);
    setMotherName(s.motherName);
    setFatherMobile(s.fatherMobile);
    setMotherMobile(s.motherMobile);
    setBloodGroup(s.bloodGroup);
    setCategory(s.category);
    setReligion(s.religion);
    setNotes(s.notes);
    setRfidNo(s.rfidNo);
    setBiometricId(s.biometricId);
    setLoginUsername(portalUsernameOf(s));
    setLoginPassword("");
    setConfirmPassword("");
  }

  function onSelectStudent(s: SisStudent | null) {
    setSelectedId(s?.id ?? "");
    setError(null);
    if (s) loadStudentFields(s);
  }

  function onDetails(e: FormEvent) {
    e.preventDefault();
    if (!selected) return setError("Select a student");
    const res = updateStudentDetails({
      studentId: selected.id,
      fullName,
      rollNo,
      gender,
      dob,
      fatherName,
      motherName,
      fatherMobile,
      motherMobile,
      bloodGroup,
      category,
      religion,
      notes,
    });
    if (!res.ok) return setError(res.error);
    setSis(res.state);
    onChanged?.(res.state);
    loadStudentFields(res.student);
    flash(`Details updated for ${res.student.fullName}`);
  }

  function onBiometric(e: FormEvent) {
    e.preventDefault();
    if (!selected) return setError("Select a student");
    const res = updateStudentBiometric({
      studentId: selected.id,
      rfidNo,
      biometricId,
    });
    if (!res.ok) return setError(res.error);
    setSis(res.state);
    onChanged?.(res.state);
    loadStudentFields(res.student);
    flash(`RFID / biometric saved for ${res.student.fullName}`);
  }

  function onPassword(e: FormEvent) {
    e.preventDefault();
    if (!selected) return setError("Select a student");
    const res = updateStudentLoginPassword({
      studentId: selected.id,
      loginUsername,
      loginPassword,
      confirmPassword,
    });
    if (!res.ok) return setError(res.error);
    setSis(res.state);
    onChanged?.(res.state);
    loadStudentFields(res.student);
    setLoginPassword("");
    setConfirmPassword("");
    flash(`Login password set for ${res.student.fullName}`);
  }

  async function onBulkStudent(files: FileList | null) {
    if (!files?.length) return;
    setBulkBusy(true);
    setError(null);
    const res = await bulkUploadStudentImages(files);
    setBulkBusy(false);
    setSis(res.state);
    onChanged?.(res.state);
    setBulkLog(
      [
        `Student images: ${res.applied} applied, ${res.skipped} skipped`,
        ...res.errors,
      ].slice(0, 25),
    );
    if (res.applied) flash(`Uploaded ${res.applied} student photo(s)`);
    else setError(res.errors[0] ?? "No photos applied");
    if (studentImgRef.current) studentImgRef.current.value = "";
  }

  async function onBulkParent(files: FileList | null) {
    if (!files?.length) return;
    setBulkBusy(true);
    setError(null);
    const res = await bulkUploadParentImages(files);
    setBulkBusy(false);
    setSis(res.state);
    onChanged?.(res.state);
    setBulkLog(
      [
        `Parent images: ${res.applied} applied, ${res.skipped} skipped`,
        ...res.errors,
      ].slice(0, 25),
    );
    if (res.applied) flash(`Uploaded ${res.applied} parent photo(s)`);
    else setError(res.errors[0] ?? "No photos applied");
    if (parentImgRef.current) parentImgRef.current.value = "";
  }

  function onStudentPhoto(studentId: string, photoUrl: string) {
    const res = setStudentPhoto(studentId, photoUrl);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSis(res.state);
    onChanged?.(res.state);
  }

  function onParentPhoto(
    studentId: string,
    which: "father" | "mother" | "guardian",
    photoUrl: string,
  ) {
    const res = setParentPhoto(studentId, which, photoUrl);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSis(res.state);
    onChanged?.(res.state);
  }

  if (!sis || !masters) {
    return (
      <p className="mt-4 text-sm text-[var(--muted)]">Loading update tools…</p>
    );
  }

  const needsStudent =
    tool === "details" || tool === "biometric" || tool === "password";
  const isPhotoTool = tool === "student_images" || tool === "parent_images";

  return (
    <div className="mt-4 space-y-5">
      <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
        <h2 className="text-base font-semibold text-[var(--brand-deep)]">
          Update students
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Quick updates for details, RFID / biometric, portal password, and
          class-wise photo capture.
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[rgba(67,160,71,0.12)] px-3 py-2 text-sm text-[#2e7d32]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTool(t.id);
              setError(null);
              setBulkLog([]);
            }}
            className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
              tool === t.id
                ? "border-transparent bg-[var(--brand-deep)] font-extrabold text-white shadow-[0_3px_12px_rgba(32,48,80,0.3)]"
                : "border-[rgba(32,48,80,0.12)] bg-white font-bold text-[var(--brand-deep)] hover:border-[var(--brand-gold)]"
            }`}
          >
            <div className="font-extrabold tracking-wide">{t.label}</div>
            <div
              className={`mt-0.5 text-xs font-semibold ${
                tool === t.id ? "text-white/80" : "text-[var(--muted)]"
              }`}
            >
              {t.hint}
            </div>
          </button>
        ))}
      </div>

      {isPhotoTool ? (
        <section className="space-y-4 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                {tool === "student_images"
                  ? "Student photos by class"
                  : "Parent photos by class"}
              </h3>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                Choose class & section, then upload or take a photo for each
                row.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Class
                </span>
                <select
                  className="field !py-1.5"
                  value={photoClassId}
                  onChange={(e) => {
                    setPhotoClassId(e.target.value);
                    setPhotoSectionId("");
                  }}
                >
                  <option value="">Select class</option>
                  {masters.classes
                    .filter((c) => c.isActive)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Section
                </span>
                <select
                  className="field !py-1.5"
                  value={photoSectionId}
                  disabled={!photoClassId}
                  onChange={(e) => setPhotoSectionId(e.target.value)}
                >
                  <option value="">All sections</option>
                  {photoSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Search
                </span>
                <input
                  className="field !max-w-[12rem] !py-1.5"
                  placeholder="Name / adm / roll"
                  value={photoQuery}
                  onChange={(e) => setPhotoQuery(e.target.value)}
                  disabled={!photoClassId}
                />
              </label>
            </div>
          </div>

          {!photoClassId ? (
            <p className="rounded-lg border border-dashed border-[rgba(32,48,80,0.15)] px-4 py-10 text-center text-sm text-[var(--muted)]">
              Select a class to see the full student list.
            </p>
          ) : !photoRoster.length ? (
            <p className="rounded-lg border border-dashed border-[rgba(32,48,80,0.15)] px-4 py-10 text-center text-sm text-[var(--muted)]">
              No active students in this class / section.
            </p>
          ) : tool === "student_images" ? (
            <ErpTableShell className="overflow-x-auto">
              <ErpTable>
                <ErpTableHead>
                  <tr>
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Student</th>
                    <th className="px-3 py-2 font-semibold">Class</th>
                    <th className="px-3 py-2 font-semibold">Photo</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {photoRoster.map((s, i) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 text-xs text-[var(--muted)]">
                        {s.rollNo || i + 1}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-[var(--brand-deep)]">
                          <StudentNameLabel student={s} sis={sis} />
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {s.admissionNo}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)]">
                        {classLabel(s, masters)}
                      </td>
                      <td className="px-3 py-2">
                        <InlinePhotoCapture
                          photoUrl={s.photoUrl}
                          label="Student"
                          onChange={(url) => onStudentPhoto(s.id, url)}
                          onError={(msg) => setError(msg)}
                        />
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            </ErpTableShell>
          ) : (
            <ErpTableShell className="overflow-x-auto">
              <ErpTable>
                <ErpTableHead>
                  <tr>
                    <th className="px-3 py-2 font-semibold">Student</th>
                    <th className="px-3 py-2 font-semibold">Father</th>
                    <th className="px-3 py-2 font-semibold">Mother</th>
                    <th className="px-3 py-2 font-semibold">Guardian</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {photoRoster.map((s) => {
                    const hh = householdOf(sis, s.householdId);
                    return (
                      <tr key={s.id}>
                        <td className="px-3 py-3 align-top">
                          <div className="font-medium text-[var(--brand-deep)]">
                            <StudentNameLabel student={s} sis={sis} />
                          </div>
                          <div className="text-[11px] text-[var(--muted)]">
                            {s.admissionNo} · {classLabel(s, masters)}
                          </div>
                          <div className="mt-1 text-[10px] text-[var(--muted)]">
                            F: {s.fatherName || "—"}
                            <br />
                            M: {s.motherName || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <InlinePhotoCapture
                            photoUrl={s.fatherPhotoUrl}
                            label="Father"
                            onChange={(url) =>
                              onParentPhoto(s.id, "father", url)
                            }
                            onError={(msg) => setError(msg)}
                          />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <InlinePhotoCapture
                            photoUrl={s.motherPhotoUrl}
                            label="Mother"
                            onChange={(url) =>
                              onParentPhoto(s.id, "mother", url)
                            }
                            onError={(msg) => setError(msg)}
                          />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <InlinePhotoCapture
                            photoUrl={hh?.guardianPhotoUrl ?? ""}
                            label="Guardian"
                            onChange={(url) =>
                              onParentPhoto(s.id, "guardian", url)
                            }
                            onError={(msg) => setError(msg)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </ErpTableBody>
              </ErpTable>
            </ErpTableShell>
          )}

          {photoClassId ? (
            <p className="text-[11px] text-[var(--muted)]">
              Showing <strong className="text-[var(--brand-deep)]">{photoRoster.length}</strong>{" "}
              student{photoRoster.length === 1 ? "" : "s"}
            </p>
          ) : null}

          <details className="rounded-lg border border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.02)] px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-deep)]">
              Optional: batch upload by filename
            </summary>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {tool === "student_images"
                ? "Files named with admission no (e.g. BHB-2025-101.jpg)."
                : "Use ADMNO_father.jpg / ADMNO_mother.jpg / ADMNO_parent.jpg."}
            </p>
            {tool === "student_images" ? (
              <>
                <input
                  ref={studentImgRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="mt-2 block w-full text-sm"
                  disabled={bulkBusy}
                  onChange={(e) => void onBulkStudent(e.target.files)}
                />
                <button
                  type="button"
                  className="mt-2 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  disabled={bulkBusy}
                  onClick={() => studentImgRef.current?.click()}
                >
                  {bulkBusy ? "Uploading…" : "Choose student photo files"}
                </button>
              </>
            ) : (
              <>
                <input
                  ref={parentImgRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="mt-2 block w-full text-sm"
                  disabled={bulkBusy}
                  onChange={(e) => void onBulkParent(e.target.files)}
                />
                <button
                  type="button"
                  className="mt-2 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  disabled={bulkBusy}
                  onClick={() => parentImgRef.current?.click()}
                >
                  {bulkBusy ? "Uploading…" : "Choose parent photo files"}
                </button>
              </>
            )}
            {bulkLog.length ? (
              <ul className="mt-2 max-h-32 overflow-auto text-[11px] text-[var(--muted)]">
                {bulkLog.map((line, i) => (
                  <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
                ))}
              </ul>
            ) : null}
          </details>
        </section>
      ) : (
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        {needsStudent ? (
          <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
            <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
              Select student
            </h3>
            <div className="mt-2">
              <StudentPicker
                sis={sis}
                masters={masters}
                selectedId={selectedId}
                sessionCode={session.academicYearCode}
                onSelect={onSelectStudent}
              />
            </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
          {tool === "details" ? (
            <>
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                Update details
              </h3>
              <form onSubmit={onDetails} className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Full name
                  </span>
                  <input
                    className="field"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={!selected}
                    required
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Roll no
                  </span>
                  <input
                    className="field"
                    value={rollNo}
                    onChange={(e) => setRollNo(e.target.value)}
                    disabled={!selected}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Gender
                  </span>
                  <select
                    className="field"
                    value={gender}
                    onChange={(e) =>
                      setGender(e.target.value as SisStudent["gender"])
                    }
                    disabled={!selected}
                  >
                    <option value="">—</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    DOB
                  </span>
                  <input
                    type="date"
                    className="field"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    disabled={!selected}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Blood group
                  </span>
                  <select
                    className="field"
                    value={bloodGroup}
                    onChange={(e) => setBloodGroup(e.target.value)}
                    disabled={!selected}
                  >
                    {BLOOD_GROUPS.map((b) => (
                      <option key={b || "x"} value={b}>
                        {b || "—"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Category
                  </span>
                  <select
                    className="field"
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as StudentCategory)
                    }
                    disabled={!selected}
                  >
                    {STUDENT_CATEGORIES.map((c) => (
                      <option key={c.value || "x"} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Religion
                  </span>
                  <input
                    className="field"
                    value={religion}
                    onChange={(e) => setReligion(e.target.value)}
                    disabled={!selected}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Father name
                  </span>
                  <input
                    className="field"
                    value={fatherName}
                    onChange={(e) => setFatherName(e.target.value)}
                    disabled={!selected}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Mother name
                  </span>
                  <input
                    className="field"
                    value={motherName}
                    onChange={(e) => setMotherName(e.target.value)}
                    disabled={!selected}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Father mobile
                  </span>
                  <input
                    className="field"
                    value={fatherMobile}
                    onChange={(e) => setFatherMobile(e.target.value)}
                    disabled={!selected}
                    maxLength={10}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Mother mobile
                  </span>
                  <input
                    className="field"
                    value={motherMobile}
                    onChange={(e) => setMotherMobile(e.target.value)}
                    disabled={!selected}
                    maxLength={10}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Notes
                  </span>
                  <input
                    className="field"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={!selected}
                  />
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <button
                    type="submit"
                    disabled={!selected}
                    className="btn-accent rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    Save details
                  </button>
                  {selected ? (
                    <Link
                      href={`/students/${selected.id}/edit`}
                      className="self-center text-xs font-medium text-[var(--brand-mid)]"
                    >
                      Full profile editor
                    </Link>
                  ) : null}
                </div>
              </form>
            </>
          ) : null}

          {tool === "biometric" ? (
            <>
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                Biometric / RFID
              </h3>
              <form onSubmit={onBiometric} className="mt-3 space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    RFID card number
                  </span>
                  <input
                    className="field"
                    value={rfidNo}
                    onChange={(e) => setRfidNo(e.target.value)}
                    disabled={!selected}
                    placeholder="Scan or type card no"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Biometric device ID
                  </span>
                  <input
                    className="field"
                    value={biometricId}
                    onChange={(e) => setBiometricId(e.target.value)}
                    disabled={!selected}
                    placeholder="Device enrolment id"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!selected}
                  className="btn-accent rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Save RFID / biometric
                </button>
              </form>
            </>
          ) : null}

          {tool === "password" ? (
            <>
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                User login password
              </h3>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                Sets portal credentials for this student (username defaults to
                admission no).
                {selected && hasPortalPassword(selected)
                  ? " A password is already set — enter a new one to replace."
                  : ""}
              </p>
              <form onSubmit={onPassword} className="mt-3 space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Username
                  </span>
                  <input
                    className="field"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    disabled={!selected}
                    autoComplete="username"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    New password
                  </span>
                  <input
                    type="password"
                    className="field"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    disabled={!selected}
                    autoComplete="new-password"
                    required
                    minLength={4}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Confirm password
                  </span>
                  <input
                    type="password"
                    className="field"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={!selected}
                    autoComplete="new-password"
                    required
                    minLength={4}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!selected}
                  className="btn-accent rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Set password
                </button>
              </form>
            </>
          ) : null}
        </section>
      </div>
      )}
    </div>
  );
}
