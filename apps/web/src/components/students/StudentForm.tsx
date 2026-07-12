"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DEFAULT_AY,
  STUDENT_TYPES,
  STUDENT_TYPE_HINTS,
  loadMasters,
  resolveFeeGroupId,
  suggestFeeStudentType,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  BLOOD_GROUPS,
  DOC_LABELS,
  PEN_STATUSES,
  STUDENT_CATEGORIES,
  alignHouseholdMobiles,
  applySharedFamilyToHousehold,
  emptyStudentDocs,
  householdOf,
  isValidMobile,
  isValidPan,
  loadSis,
  newSisId,
  normalizeMobile,
  normalizePan,
  normalizeStudent,
  normalizeStudentDocs,
  pendingCurriculumRequests,
  profileCompleteness,
  reviewCurriculumRequest,
  saveSis,
  sharedFamilyContactsOf,
  suggestAdmissionNo,
  syncPhotoDoc,
  type CurriculumRequest,
  type Household,
  type PenStatus,
  type SisStudent,
  type StudentCategory,
  type StudentDocFile,
  type StudentDocKey,
  type StudentDocs,
} from "@/lib/sis";
import {
  confirmCurriculum,
  defaultCurriculum,
  validateCurriculum,
  type StudentCurriculum,
} from "@/lib/studentCurriculum";
import { StudentDocUpload } from "@/components/students/StudentDocUpload";
import { StudentPhotoField } from "@/components/students/StudentPhotoField";
import { StudentCurriculumEditor } from "@/components/students/StudentCurriculumEditor";
import { StudentTypeBadge } from "@/components/students/StudentAvatar";

type Tab = "basic" | "subjects" | "identity" | "family" | "ids" | "docs";

const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "subjects", label: "Subjects" },
  { id: "identity", label: "Identity" },
  { id: "family", label: "Family" },
  { id: "ids", label: "IDs" },
  { id: "docs", label: "Documents" },
];

export function StudentForm({
  mode,
  studentId,
}: {
  mode: "create" | "edit";
  studentId?: string;
}) {
  const router = useRouter();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("basic");

  const [admissionNo, setAdmissionNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<SisStudent["gender"]>("");
  const [dob, setDob] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [studentType, setStudentType] = useState<FeeStudentType>("NEW");
  const [feeGroupId, setFeeGroupId] = useState("");
  const [joinedOn, setJoinedOn] = useState("");
  const [status, setStatus] = useState<SisStudent["status"]>("active");
  const [photoUrl, setPhotoUrl] = useState("");
  const [notes, setNotes] = useState("");

  const [bloodGroup, setBloodGroup] = useState("");
  const [religion, setReligion] = useState("");
  const [category, setCategory] = useState<StudentCategory>("");
  const [nationality, setNationality] = useState("Indian");
  const [motherTongue, setMotherTongue] = useState("");
  const [placeOfBirth, setPlaceOfBirth] = useState("");
  const [aadhaarLast4, setAadhaarLast4] = useState("");

  const [fatherName, setFatherName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [fatherMobile, setFatherMobile] = useState("");
  const [motherMobile, setMotherMobile] = useState("");
  const [fatherAadhaarLast4, setFatherAadhaarLast4] = useState("");
  const [motherAadhaarLast4, setMotherAadhaarLast4] = useState("");
  const [fatherPan, setFatherPan] = useState("");
  const [motherPan, setMotherPan] = useState("");
  const [guardianRelation, setGuardianRelation] = useState("Father");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyMobile, setEmergencyMobile] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [mobile, setMobile] = useState("");
  const [whatsappMobile, setWhatsappMobile] = useState("");
  const [altMobile, setAltMobile] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [locality, setLocality] = useState("");
  const [landmark, setLandmark] = useState("");
  const [city, setCity] = useState("Varanasi");
  const [stateName, setStateName] = useState("Uttar Pradesh");
  const [pincode, setPincode] = useState("");
  const [linkHouseholdId, setLinkHouseholdId] = useState("");

  const [pen, setPen] = useState("");
  const [penStatus, setPenStatus] = useState<PenStatus>("");
  const [apaarId, setApaarId] = useState("");
  const [srn, setSrn] = useState("");
  const [previousSchool, setPreviousSchool] = useState("");
  const [previousTcNo, setPreviousTcNo] = useState("");
  const [previousUdise, setPreviousUdise] = useState("");

  const [docs, setDocs] = useState<StudentDocs>(emptyStudentDocs());
  const [curriculum, setCurriculum] = useState<StudentCurriculum>({
    academicYearCode: DEFAULT_AY,
    seniorStreamId: null,
    chosenSubjectIds: [],
    confirmedAt: "",
    confirmedBy: "system",
  });
  const [pendingRequest, setPendingRequest] = useState<CurriculumRequest | null>(
    null,
  );
  const [reviewNote, setReviewNote] = useState("");

  useEffect(() => {
    const m = loadMasters();
    const sis = loadSis();
    setMasters(m);

    if (mode === "edit" && studentId) {
      const raw = sis.students.find((x) => x.id === studentId);
      if (!raw) {
        setMissing(true);
        return;
      }
      const s = normalizeStudent(raw);
      const hh = householdOf(sis, s.householdId);
      setAdmissionNo(s.admissionNo);
      setFullName(s.fullName);
      setGender(s.gender);
      setDob(s.dob);
      setClassId(s.classId);
      setSectionId(s.sectionId);
      setRollNo(s.rollNo);
      setStudentType(s.studentType);
      setFeeGroupId(s.feeGroupId ?? "");
      setJoinedOn(s.joinedOn || "");
      setStatus(s.status);
      setPhotoUrl(s.photoUrl);
      setNotes(s.notes);
      setCurriculum(
        defaultCurriculum(
          { classId: s.classId, academicYearCode: s.academicYearCode, curriculum: s.curriculum },
          m,
        ),
      );
      setPendingRequest(
        pendingCurriculumRequests(sis, s.id)[0] ?? null,
      );
      setBloodGroup(s.bloodGroup);
      setReligion(s.religion);
      setCategory(s.category);
      setNationality(s.nationality || "Indian");
      setMotherTongue(s.motherTongue);
      setPlaceOfBirth(s.placeOfBirth);
      setAadhaarLast4(s.aadhaarLast4);
      setFatherName(s.fatherName);
      setMotherName(s.motherName);
      setFatherMobile(s.fatherMobile);
      setMotherMobile(s.motherMobile);
      setFatherAadhaarLast4(s.fatherAadhaarLast4);
      setMotherAadhaarLast4(s.motherAadhaarLast4);
      setFatherPan(s.fatherPan);
      setMotherPan(s.motherPan);
      setGuardianRelation(s.guardianRelation || "Father");
      setEmergencyName(s.emergencyName);
      setEmergencyMobile(s.emergencyMobile);
      setGuardianName(hh?.guardianName ?? "");
      setMobile(hh?.mobile ?? "");
      setWhatsappMobile(hh?.whatsappMobile || hh?.mobile || "");
      setAltMobile(hh?.altMobile ?? "");
      setEmail(hh?.email ?? "");
      setAddress(hh?.address ?? "");
      setLocality(hh?.locality ?? "");
      setLandmark(hh?.landmark ?? "");
      setCity(hh?.city ?? "Varanasi");
      setStateName(hh?.state ?? "Uttar Pradesh");
      setPincode(hh?.pincode ?? "");
      setLinkHouseholdId(s.householdId);
      setPen(s.pen);
      setPenStatus(s.penStatus);
      setApaarId(s.apaarId);
      setSrn(s.srn);
      setPreviousSchool(s.previousSchool);
      setPreviousTcNo(s.previousTcNo);
      setPreviousUdise(s.previousUdise);
      setDocs(normalizeStudentDocs(s.docs));
      return;
    }

    setAdmissionNo(suggestAdmissionNo(sis.students));
    setStudentType("NEW");
    setFeeGroupId("");
    setJoinedOn(new Date().toISOString().slice(0, 10));
    const firstClass = m.classes.find((c) => c.isActive) ?? m.classes[0];
    setClassId(firstClass?.id ?? "");
    const firstSec = m.sections.find(
      (s) => s.classId === firstClass?.id && s.isActive,
    );
    setSectionId(firstSec?.id ?? "");
    setCurriculum(
      defaultCurriculum(
        {
          classId: firstClass?.id ?? "",
          academicYearCode: DEFAULT_AY,
          curriculum: null,
        },
        m,
      ),
    );
    setPendingRequest(null);
  }, [mode, studentId]);

  const sectionsForClass = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter((s) => s.classId === classId && s.isActive);
  }, [masters, classId]);

  const feeGroupsForType = useMemo(() => {
    if (!masters) return [];
    const types: FeeStudentType[] =
      studentType === "MID_YEAR"
        ? ["MID_YEAR", "NEW"]
        : studentType === "RTE"
          ? ["RTE", "NEW"]
          : [studentType];
    return masters.feeGroups.filter(
      (g) =>
        g.isActive &&
        g.academicYearCode === DEFAULT_AY &&
        types.includes(g.studentType) &&
        (g.classIds.length === 0 ||
          !classId ||
          g.classIds.includes(classId)),
    );
  }, [masters, studentType, classId]);

  useEffect(() => {
    if (!masters || !classId) return;
    setFeeGroupId((prev) => {
      if (prev && feeGroupsForType.some((g) => g.id === prev)) return prev;
      return (
        resolveFeeGroupId(masters, {
          studentType,
          classId,
          academicYearCode: DEFAULT_AY,
          preferPublished: true,
        }) ?? ""
      );
    });
  }, [masters, studentType, classId, feeGroupsForType]);

  useEffect(() => {
    if (!masters || !classId) return;
    if (!sectionsForClass.some((s) => s.id === sectionId)) {
      setSectionId(sectionsForClass[0]?.id ?? "");
    }
  }, [masters, classId, sectionId, sectionsForClass]);

  const draftCompleteness = useMemo(() => {
    const synced = syncPhotoDoc(docs, photoUrl);
    const draft = normalizeStudent({
      id: studentId ?? "draft",
      admissionNo,
      fullName,
      gender,
      dob,
      classId,
      sectionId,
      fatherName,
      motherName,
      pen,
      penStatus,
      bloodGroup,
      category,
      photoUrl,
      docs: synced,
    });
    const hhDraft: Household = {
      id: "draft",
      code: "",
      guardianName,
      mobile,
      whatsappMobile: whatsappMobile || mobile,
      email,
      address,
      locality,
      landmark,
      city,
      state: stateName,
      pincode,
      altMobile,
    };
    return profileCompleteness(draft, hhDraft);
  }, [
    studentId,
    admissionNo,
    fullName,
    gender,
    dob,
    classId,
    sectionId,
    fatherName,
    motherName,
    pen,
    penStatus,
    bloodGroup,
    category,
    photoUrl,
    docs,
    guardianName,
    mobile,
    whatsappMobile,
    email,
    address,
    locality,
    landmark,
    city,
    stateName,
    pincode,
    altMobile,
  ]);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2200);
  }

  function setDocFile(key: StudentDocKey, file: StudentDocFile) {
    setDocs((prev) => {
      const next = { ...prev, [key]: file };
      if (key === "photo") {
        setPhotoUrl(file.fileUrl);
      }
      return next;
    });
  }

  function onPhotoChange(url: string) {
    setPhotoUrl(url);
    setDocs((prev) => syncPhotoDoc(prev, url));
  }

  function saveStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!masters) return;
    const sis = loadSis();
    if (!fullName.trim() || !admissionNo.trim() || !classId || !sectionId) {
      flash("Basic: name, admission no, class and section are required");
      setTab("basic");
      return;
    }
    const mobileDigits = normalizeMobile(mobile);
    if (!isValidMobile(mobileDigits)) {
      flash("Family: guardian mobile must be exactly 10 digits");
      setTab("family");
      return;
    }
    const whatsappDigits = normalizeMobile(whatsappMobile) || mobileDigits;
    if (!isValidMobile(whatsappDigits)) {
      flash("Family: WhatsApp number must be exactly 10 digits");
      setTab("family");
      return;
    }
    if (aadhaarLast4 && aadhaarLast4.length !== 4) {
      flash("Identity: Aadhaar last 4 must be 4 digits");
      setTab("identity");
      return;
    }
    for (const [label, val] of [
      ["Father Aadhaar last 4", fatherAadhaarLast4],
      ["Mother Aadhaar last 4", motherAadhaarLast4],
    ] as const) {
      if (val && val.length !== 4) {
        flash(`Family: ${label} must be 4 digits`);
        setTab("family");
        return;
      }
    }
    for (const [label, val] of [
      ["Father PAN", fatherPan],
      ["Mother PAN", motherPan],
    ] as const) {
      const p = normalizePan(val);
      if (p && !isValidPan(p)) {
        flash(`Family: ${label} must be like ABCDE1234F`);
        setTab("family");
        return;
      }
    }
    for (const [label, val] of [
      ["Father mobile", fatherMobile],
      ["Mother mobile", motherMobile],
      ["Emergency mobile", emergencyMobile],
      ["Alt mobile", altMobile],
    ] as const) {
      const d = normalizeMobile(val);
      if (d && !isValidMobile(d)) {
        flash(`Family: ${label} must be 10 digits or blank`);
        setTab("family");
        return;
      }
    }

    const nextAdm = admissionNo.trim().toUpperCase();
    if (
      sis.students.some(
        (s) =>
          s.admissionNo.toUpperCase() === nextAdm && s.id !== studentId,
      )
    ) {
      flash("Admission number already exists");
      setTab("basic");
      return;
    }

    const campusId =
      masters.campuses.find((c) => c.isPrimary)?.id ??
      masters.campuses[0]?.id ??
      "";

    let households = [...sis.households];
    let householdId = linkHouseholdId;
    const previousStudent =
      mode === "edit" && studentId
        ? sis.students.find((s) => s.id === studentId)
        : undefined;
    const previousHousehold =
      householdId && households.some((h) => h.id === householdId)
        ? households.find((h) => h.id === householdId)
        : null;

    const aligned = alignHouseholdMobiles({
      relation: guardianRelation,
      fatherMobile,
      motherMobile,
      householdMobile: mobileDigits,
      whatsappMobile: whatsappDigits,
      previousHousehold,
      previousFatherMobile: previousStudent?.fatherMobile,
      previousMotherMobile: previousStudent?.motherMobile,
    });

    const hhPayload = {
      guardianName: guardianName.trim() || fatherName.trim() || "Guardian",
      mobile: aligned.householdMobile,
      whatsappMobile: aligned.whatsappMobile,
      email: email.trim(),
      address: address.trim() || "Varanasi, Uttar Pradesh",
      locality: locality.trim(),
      landmark: landmark.trim(),
      city: city.trim(),
      state: stateName.trim() || "Uttar Pradesh",
      pincode: pincode.replace(/\D/g, "").slice(0, 6),
      altMobile: normalizeMobile(altMobile),
    };

    if (householdId && households.some((h) => h.id === householdId)) {
      households = households.map((h) =>
        h.id === householdId ? { ...h, ...hhPayload } : h,
      );
    } else {
      const hh: Household = {
        id: newSisId("hh"),
        code: `HH-${100 + households.length + 1}`,
        ...hhPayload,
      };
      households.push(hh);
      householdId = hh.id;
    }

    const nextDocs = syncPhotoDoc(docs, photoUrl.trim());

    const curCheck = validateCurriculum(
      { classId, academicYearCode: DEFAULT_AY },
      curriculum,
      masters,
    );
    if (!curCheck.ok) {
      flash(curCheck.errors[0] ?? "Fix subject choices");
      setTab("subjects");
      return;
    }

    const payload = normalizeStudent({
      id: studentId ?? newSisId("stu"),
      admissionNo: nextAdm,
      fullName: fullName.trim(),
      gender,
      dob,
      campusId,
      classId,
      sectionId,
      rollNo: rollNo.trim(),
      academicYearCode: DEFAULT_AY,
      studentType,
      feeGroupId: feeGroupId || null,
      joinedOn: joinedOn.trim(),
      fatherName: fatherName.trim(),
      motherName: motherName.trim(),
      fatherMobile: aligned.fatherMobile,
      motherMobile: aligned.motherMobile,
      fatherAadhaarLast4: fatherAadhaarLast4.replace(/\D/g, "").slice(0, 4),
      motherAadhaarLast4: motherAadhaarLast4.replace(/\D/g, "").slice(0, 4),
      fatherPan: normalizePan(fatherPan),
      motherPan: normalizePan(motherPan),
      guardianRelation: guardianRelation.trim() || "Father",
      emergencyName: emergencyName.trim(),
      emergencyMobile: normalizeMobile(emergencyMobile),
      householdId,
      bloodGroup,
      religion: religion.trim(),
      category,
      nationality: nationality.trim() || "Indian",
      motherTongue: motherTongue.trim(),
      placeOfBirth: placeOfBirth.trim(),
      aadhaarLast4: aadhaarLast4.replace(/\D/g, "").slice(0, 4),
      pen: pen.trim(),
      penStatus,
      apaarId: apaarId.trim(),
      srn: srn.trim(),
      previousSchool: previousSchool.trim(),
      previousTcNo: previousTcNo.trim(),
      previousUdise: previousUdise.trim(),
      docs: nextDocs,
      notes: notes.trim(),
      photoUrl: photoUrl.trim() || nextDocs.photo.fileUrl,
      status: mode === "edit" ? status : "active",
      curriculum: confirmCurriculum(
        { ...curriculum, academicYearCode: DEFAULT_AY },
        "office",
      ),
    });

    const students = applySharedFamilyToHousehold(
      mode === "edit" && studentId
        ? sis.students.map((s) => (s.id === studentId ? payload : s))
        : [...sis.students, payload],
      householdId,
      sharedFamilyContactsOf(payload),
      payload,
    );

    saveSis({
      ...sis,
      households,
      students,
    });

    if (mode === "edit" && studentId) {
      router.push("/students");
      return;
    }
    router.push(`/students/${payload.id}/edit`);
  }

  if (missing) {
    return (
      <div>
        <p className="text-sm text-[var(--muted)]">Student not found.</p>
        <Link
          href="/students"
          className="mt-3 inline-block text-sm font-medium text-[var(--brand-mid)]"
        >
          ← Back to students
        </Link>
      </div>
    );
  }

  if (!masters) {
    return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href="/students"
            className="text-xs font-medium text-[var(--brand-mid)]"
          >
            ← Students
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--brand-deep)]">
            {mode === "edit" ? (
              <>
                <StudentTypeBadge type={studentType} />
                {fullName || "Edit student"}
              </>
            ) : (
              "Add student"
            )}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {DEFAULT_AY} · Student profile · {draftCompleteness}% complete
          </p>
        </div>
        {notice ? (
          <span className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
            {notice}
          </span>
        ) : null}
      </div>

      <div
        className="mt-5 flex gap-1 overflow-x-auto border-b border-[rgba(32,48,80,0.12)]"
        role="tablist"
      >
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.id)}
              className={`relative shrink-0 px-3 pb-2.5 text-sm font-medium ${
                on
                  ? "text-[var(--brand-deep)]"
                  : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
              }`}
            >
              {t.label}
              <span
                className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--brand-gold)] transition ${
                  on ? "opacity-100" : "opacity-0"
                }`}
              />
            </button>
          );
        })}
      </div>

      <form
        onSubmit={saveStudent}
        className="mt-5 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-5"
      >
        {tab === "basic" ? (
          <div>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Enrollment essentials for the SIS register and Fee Take.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Admission no">
                <input
                  className="field"
                  value={admissionNo}
                  onChange={(e) => setAdmissionNo(e.target.value)}
                  required
                />
              </Field>
              <Field label="Full name">
                <input
                  className="field"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </Field>
            </div>
            <StudentPhotoField
              fullName={fullName}
              photoUrl={photoUrl}
              onChange={onPhotoChange}
              onError={flash}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Class">
                <select
                  className="field"
                  value={classId}
                  onChange={(e) => {
                    const nextClass = e.target.value;
                    setClassId(nextClass);
                    const sec = masters.sections.find(
                      (s) => s.classId === nextClass && s.isActive,
                    );
                    setSectionId(sec?.id ?? "");
                    setCurriculum(
                      defaultCurriculum(
                        {
                          classId: nextClass,
                          academicYearCode: DEFAULT_AY,
                          curriculum: null,
                        },
                        masters,
                      ),
                    );
                  }}
                  required
                >
                  {masters.classes
                    .filter((c) => c.isActive)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Section">
                <select
                  className="field"
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  required
                >
                  {sectionsForClass.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Roll no">
                <input
                  className="field"
                  value={rollNo}
                  onChange={(e) => setRollNo(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Joined on (session)">
                <input
                  type="date"
                  className="field"
                  value={joinedOn}
                  onChange={(e) => {
                    const next = e.target.value;
                    setJoinedOn(next);
                    if (mode === "create" || studentType === "NEW" || studentType === "MID_YEAR") {
                      setStudentType(
                        suggestFeeStudentType(next, DEFAULT_AY, studentType),
                      );
                    }
                  }}
                />
              </Field>
              <Field label="Student type">
                <select
                  className="field"
                  value={studentType}
                  onChange={(e) => {
                    setStudentType(e.target.value as FeeStudentType);
                  }}
                >
                  {STUDENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fee group">
                <select
                  className="field"
                  value={feeGroupId}
                  onChange={(e) => setFeeGroupId(e.target.value)}
                >
                  <option value="">— Assign later —</option>
                  {feeGroupsForType.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.studentType !== studentType
                        ? ` (${g.studentType})`
                        : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
              {STUDENT_TYPE_HINTS[studentType]}
              {feeGroupId
                ? " Fee group auto-fills from type + class; you can override."
                : " No matching published group — create one under Masters → Fee groups."}
            </p>
            {mode === "edit" ? (
              <Field label="Status">
                <select
                  className="field"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as SisStudent["status"])
                  }
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            ) : null}
            <Field label="Notes">
              <input
                className="field"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {tab === "subjects" && masters ? (
          <div>
            {pendingRequest ? (
              <div className="mb-4 rounded-xl border border-[rgba(196,149,58,0.35)] bg-[rgba(196,149,58,0.08)] p-3">
                <p className="text-sm font-bold text-[var(--brand-deep)]">
                  Parent subject change request
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {pendingRequest.note || "No note"} · requested{" "}
                  {new Date(pendingRequest.requestedAt).toLocaleString()}
                </p>
                <p className="mt-2 text-xs text-[var(--brand-deep)]">
                  Proposed subjects:{" "}
                  {pendingRequest.proposedChosenSubjectIds
                    .map(
                      (id) =>
                        masters.subjects.find((s) => s.id === id)?.code ?? "?",
                    )
                    .join(", ") || "—"}
                  {pendingRequest.proposedStreamId
                    ? ` · counselor package: ${
                        masters.seniorStreams?.find(
                          (s) => s.id === pendingRequest.proposedStreamId,
                        )?.nameEn ?? pendingRequest.proposedStreamId
                      }`
                    : ""}
                </p>
                <input
                  className="field mt-2 !py-1.5"
                  placeholder="Review note (optional)"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-bold text-white"
                    onClick={() => {
                      const res = reviewCurriculumRequest({
                        requestId: pendingRequest.id,
                        decision: "approved",
                        reviewNote,
                      });
                      if (!res.ok) {
                        flash(res.error);
                        return;
                      }
                      setCurriculum({
                        academicYearCode: pendingRequest.academicYearCode,
                        seniorStreamId: pendingRequest.proposedStreamId,
                        chosenSubjectIds:
                          pendingRequest.proposedChosenSubjectIds,
                        confirmedAt: new Date().toISOString(),
                        confirmedBy: "office",
                      });
                      setPendingRequest(null);
                      setReviewNote("");
                      flash("Subject request approved");
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(180,60,60,0.35)] px-3 py-1.5 text-xs font-bold text-[var(--danger)]"
                    onClick={() => {
                      const res = reviewCurriculumRequest({
                        requestId: pendingRequest.id,
                        decision: "rejected",
                        reviewNote,
                      });
                      if (!res.ok) {
                        flash(res.error);
                        return;
                      }
                      setPendingRequest(null);
                      setReviewNote("");
                      flash("Subject request rejected");
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : null}
            <StudentCurriculumEditor
              student={{
                classId,
                academicYearCode: DEFAULT_AY,
                curriculum,
              }}
              masters={masters}
              curriculum={curriculum}
              onChange={setCurriculum}
              mode="office"
            />
            <p className="mt-3 text-[11px] text-[var(--muted)]">
              Saving the student form confirms these subjects for {DEFAULT_AY}.
            </p>
          </div>
        ) : null}

        {tab === "identity" ? (
          <div>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Personal identity for registers, medical & compliance.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Gender">
                <select
                  className="field"
                  value={gender}
                  onChange={(e) =>
                    setGender(e.target.value as SisStudent["gender"])
                  }
                >
                  <option value="">—</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </Field>
              <Field label="Date of birth">
                <input
                  type="date"
                  className="field"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                />
              </Field>
              <Field label="Blood group">
                <select
                  className="field"
                  value={bloodGroup}
                  onChange={(e) => setBloodGroup(e.target.value)}
                >
                  {BLOOD_GROUPS.map((g) => (
                    <option key={g || "none"} value={g}>
                      {g || "—"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select
                  className="field"
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as StudentCategory)
                  }
                >
                  {STUDENT_CATEGORIES.map((c) => (
                    <option key={c.value || "none"} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Religion">
                <input
                  className="field"
                  value={religion}
                  onChange={(e) => setReligion(e.target.value)}
                />
              </Field>
              <Field label="Nationality">
                <input
                  className="field"
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                />
              </Field>
              <Field label="Mother tongue">
                <input
                  className="field"
                  value={motherTongue}
                  onChange={(e) => setMotherTongue(e.target.value)}
                />
              </Field>
              <Field label="Place of birth">
                <input
                  className="field"
                  value={placeOfBirth}
                  onChange={(e) => setPlaceOfBirth(e.target.value)}
                />
              </Field>
              <Field label="Aadhaar last 4 digits">
                <input
                  className="field"
                  value={aadhaarLast4}
                  onChange={(e) =>
                    setAadhaarLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="XXXX"
                />
              </Field>
            </div>
          </div>
        ) : null}

        {tab === "family" ? (
          <div>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Parents, guardian household (siblings share a household), emergency
              contact. Changing father/mother or guardian mobile updates the
              household and every sibling on save.
            </p>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Parents’ contacts and IDs, household address (with locality for
              transport), and emergency contact.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Father’s name">
                <input
                  className="field"
                  value={fatherName}
                  onChange={(e) => setFatherName(e.target.value)}
                />
              </Field>
              <Field label="Father mobile">
                <input
                  className="field"
                  value={fatherMobile}
                  onChange={(e) =>
                    setFatherMobile(normalizeMobile(e.target.value))
                  }
                  inputMode="numeric"
                  maxLength={10}
                />
              </Field>
              <Field label="Father Aadhaar last 4">
                <input
                  className="field"
                  value={fatherAadhaarLast4}
                  onChange={(e) =>
                    setFatherAadhaarLast4(
                      e.target.value.replace(/\D/g, "").slice(0, 4),
                    )
                  }
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                />
              </Field>
              <Field label="Father PAN">
                <input
                  className="field uppercase"
                  value={fatherPan}
                  onChange={(e) => setFatherPan(normalizePan(e.target.value))}
                  maxLength={10}
                  placeholder="ABCDE1234F"
                />
              </Field>
              <Field label="Mother’s name">
                <input
                  className="field"
                  value={motherName}
                  onChange={(e) => setMotherName(e.target.value)}
                />
              </Field>
              <Field label="Mother mobile">
                <input
                  className="field"
                  value={motherMobile}
                  onChange={(e) =>
                    setMotherMobile(normalizeMobile(e.target.value))
                  }
                  inputMode="numeric"
                  maxLength={10}
                />
              </Field>
              <Field label="Mother Aadhaar last 4">
                <input
                  className="field"
                  value={motherAadhaarLast4}
                  onChange={(e) =>
                    setMotherAadhaarLast4(
                      e.target.value.replace(/\D/g, "").slice(0, 4),
                    )
                  }
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                />
              </Field>
              <Field label="Mother PAN">
                <input
                  className="field uppercase"
                  value={motherPan}
                  onChange={(e) => setMotherPan(normalizePan(e.target.value))}
                  maxLength={10}
                  placeholder="ABCDE1234F"
                />
              </Field>
            </div>

            <div className="mt-4 border-t border-[rgba(32,48,80,0.08)] pt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Household / guardian
              </div>
              <Field label="Link existing household (siblings)">
                <select
                  className="field"
                  value={linkHouseholdId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setLinkHouseholdId(id);
                    const hh = loadSis().households.find((h) => h.id === id);
                    if (hh) {
                      setGuardianName(hh.guardianName);
                      setMobile(hh.mobile);
                      setWhatsappMobile(hh.whatsappMobile || hh.mobile);
                      setAltMobile(hh.altMobile);
                      setEmail(hh.email);
                      setAddress(hh.address);
                      setLocality(hh.locality);
                      setLandmark(hh.landmark);
                      setCity(hh.city);
                      setStateName(hh.state);
                      setPincode(hh.pincode);
                    }
                  }}
                >
                  <option value="">New household</option>
                  {loadSis().households.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.code} · {h.guardianName} · {h.mobile}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Guardian name">
                  <input
                    className="field"
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                  />
                </Field>
                <Field label="Guardian relation">
                  <input
                    className="field"
                    value={guardianRelation}
                    onChange={(e) => setGuardianRelation(e.target.value)}
                    placeholder="Father / Mother / Other"
                  />
                </Field>
                <Field label="Mobile (10 digits)">
                  <input
                    className="field"
                    value={mobile}
                    onChange={(e) => setMobile(normalizeMobile(e.target.value))}
                    inputMode="numeric"
                    maxLength={10}
                    required
                  />
                </Field>
                <Field label="WhatsApp (communications)">
                  <input
                    className="field"
                    value={whatsappMobile}
                    onChange={(e) =>
                      setWhatsappMobile(normalizeMobile(e.target.value))
                    }
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="Defaults to guardian mobile"
                  />
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    Fee reminders, receipts, and all WhatsApp messages use this
                    number for the household.
                  </p>
                </Field>
                <Field label="Alt mobile">
                  <input
                    className="field"
                    value={altMobile}
                    onChange={(e) =>
                      setAltMobile(normalizeMobile(e.target.value))
                    }
                    inputMode="numeric"
                    maxLength={10}
                  />
                </Field>
                <Field label="Email">
                  <input
                    className="field"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Address line (house / street)">
                <input
                  className="field"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="House no., street"
                />
              </Field>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Locality / area">
                  <input
                    className="field"
                    value={locality}
                    onChange={(e) => setLocality(e.target.value)}
                    placeholder="e.g. Lanka, BHU side"
                  />
                </Field>
                <Field label="Landmark">
                  <input
                    className="field"
                    value={landmark}
                    onChange={(e) => setLandmark(e.target.value)}
                    placeholder="Near temple / crossing"
                  />
                </Field>
              </div>
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Locality + landmark help assign a bus stop later. Transport fees
                use route/stop zones — not GPS from this address alone.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="City">
                  <input
                    className="field"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </Field>
                <Field label="State">
                  <input
                    className="field"
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                  />
                </Field>
                <Field label="PIN">
                  <input
                    className="field"
                    value={pincode}
                    onChange={(e) =>
                      setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    inputMode="numeric"
                    maxLength={6}
                  />
                </Field>
              </div>
            </div>

            <div className="mt-4 border-t border-[rgba(32,48,80,0.08)] pt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Emergency contact
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <input
                    className="field"
                    value={emergencyName}
                    onChange={(e) => setEmergencyName(e.target.value)}
                  />
                </Field>
                <Field label="Mobile">
                  <input
                    className="field"
                    value={emergencyMobile}
                    onChange={(e) =>
                      setEmergencyMobile(normalizeMobile(e.target.value))
                    }
                    inputMode="numeric"
                    maxLength={10}
                  />
                </Field>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "ids" ? (
          <div>
            <p className="mb-3 text-xs text-[var(--muted)]">
              UDISE PEN, APAAR, SRN and previous-school details for transfer-in.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="PEN">
                <input
                  className="field"
                  value={pen}
                  onChange={(e) => setPen(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
              <Field label="PEN status">
                <select
                  className="field"
                  value={penStatus}
                  onChange={(e) => setPenStatus(e.target.value as PenStatus)}
                >
                  {PEN_STATUSES.map((p) => (
                    <option key={p.value || "none"} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="APAAR ID">
                <input
                  className="field"
                  value={apaarId}
                  onChange={(e) => setApaarId(e.target.value)}
                />
              </Field>
              <Field label="SRN">
                <input
                  className="field"
                  value={srn}
                  onChange={(e) => setSrn(e.target.value)}
                  placeholder="School registration no."
                />
              </Field>
              <Field label="Previous school">
                <input
                  className="field"
                  value={previousSchool}
                  onChange={(e) => setPreviousSchool(e.target.value)}
                />
              </Field>
              <Field label="Previous TC no.">
                <input
                  className="field"
                  value={previousTcNo}
                  onChange={(e) => setPreviousTcNo(e.target.value)}
                />
              </Field>
              <Field label="Previous school UDISE">
                <input
                  className="field"
                  value={previousUdise}
                  onChange={(e) => setPreviousUdise(e.target.value)}
                />
              </Field>
            </div>
          </div>
        ) : null}

        {tab === "docs" ? (
          <div>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Upload PDF or image for each document. Passport photo stays in sync
              with Basic. Mark verified after office check. Demo stores files in
              the browser; production uses Supabase Storage.
            </p>
            <ul className="divide-y divide-[rgba(32,48,80,0.08)] rounded-xl border border-[rgba(32,48,80,0.12)]">
              {DOC_LABELS.map((d) => (
                <StudentDocUpload
                  key={d.key}
                  label={d.label}
                  value={docs[d.key]}
                  isPhoto={d.key === "photo"}
                  onChange={(file) => setDocFile(d.key, file)}
                  onError={flash}
                />
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[rgba(32,48,80,0.08)] pt-4">
          <Link
            href="/students"
            className="rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
          >
            Cancel
          </Link>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            {tab !== "basic" ? (
              <button
                type="button"
                className="rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                onClick={() => {
                  const i = TABS.findIndex((t) => t.id === tab);
                  if (i > 0) setTab(TABS[i - 1]!.id);
                }}
              >
                Previous
              </button>
            ) : null}
            {tab !== "docs" ? (
              <button
                type="button"
                className="rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                onClick={() => {
                  const i = TABS.findIndex((t) => t.id === tab);
                  if (i < TABS.length - 1) setTab(TABS[i + 1]!.id);
                }}
              >
                Next
              </button>
            ) : null}
            <button
              type="submit"
              className="btn-accent rounded-xl px-4 py-2.5 text-sm font-semibold"
            >
              {mode === "edit" ? "Save profile" : "Save & continue profile"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-3 block text-sm first:mt-0">
      <span className="mb-1.5 block text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
