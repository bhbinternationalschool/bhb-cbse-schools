"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  STUDENT_TYPES,
  STUDENT_TYPE_HINTS,
  loadMasters,
  resolveFeeGroupId,
  suggestFeeStudentType,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import { bumpStudentSeriesUses } from "@/lib/numberSeries";
import {
  BLOOD_GROUPS,
  DOC_LABELS,
  PEN_STATUSES,
  STUDENT_CATEGORIES,
  alignHouseholdMobiles,
  applySharedFamilyToHousehold,
  displayAadhaar,
  emptyStudentDocs,
  householdOf,
  isValidMobile,
  isValidPan,
  loadSis,
  newSisId,
  normalizeHousehold,
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
  suggestRegistrationNo,
  syncPhotoDoc,
  type AadhaarVerificationStatus,
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
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { listStudentTags } from "@/lib/studentTags";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { AddressAutocompleteField } from "@/components/maps/AddressAutocompleteField";
import {
  householdGeoFromPlace,
  type HouseholdPlaceGeo,
} from "@/lib/mapsPlaces";
import { householdHasGeo } from "@/lib/mapsGeocode";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";

function householdPlaceGeoFromRecord(
  hh: Household,
): HouseholdPlaceGeo | null {
  if (!householdHasGeo(hh)) return null;
  return {
    geoLat: hh.geoLat!,
    geoLng: hh.geoLng!,
    geoPlaceId: hh.geoPlaceId || "",
    geoFormattedAddress: hh.geoFormattedAddress || "",
    geoGeocodedAt: hh.geoGeocodedAt || "",
    geoSource: hh.geoSource || "geocode",
    geoConfidence: hh.geoConfidence || "low",
    geoAddressKey: hh.geoAddressKey || "",
  };
}

type Tab = "basic" | "subjects" | "identity" | "family" | "ids" | "docs";

const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "subjects", label: "Subjects" },
  { id: "identity", label: "Identity" },
  { id: "family", label: "Family" },
  { id: "ids", label: "IDs" },
  { id: "docs", label: "Documents" },
];

/** Extended profile fields (string except isCwsn) grouped to keep state tidy. */
type StudentExtraFields = {
  caste: string;
  admissionClass: string;
  admissionFormNo: string;
  registrationNo: string;
  tcNo: string;
  previousSchoolClass: string;
  previousSchoolYear: string;
  permanentAddress: string;
  permanentCity: string;
  permanentState: string;
  permanentPincode: string;
  transportRoute: string;
  heightCm: string;
  weightKg: string;
  isCwsn: boolean;
  disabilityDetails: string;
  medicalNotes: string;
  fatherOccupation: string;
  motherOccupation: string;
  fatherQualification: string;
  motherQualification: string;
  annualIncome: string;
  bankName: string;
  bankAccountNo: string;
  bankIfsc: string;
  secondLanguage: string;
  thirdLanguage: string;
  hobbies: string;
};

function emptyExtraFields(): StudentExtraFields {
  return {
    caste: "",
    admissionClass: "",
    admissionFormNo: "",
    registrationNo: "",
    tcNo: "",
    previousSchoolClass: "",
    previousSchoolYear: "",
    permanentAddress: "",
    permanentCity: "",
    permanentState: "",
    permanentPincode: "",
    transportRoute: "",
    heightCm: "",
    weightKg: "",
    isCwsn: false,
    disabilityDetails: "",
    medicalNotes: "",
    fatherOccupation: "",
    motherOccupation: "",
    fatherQualification: "",
    motherQualification: "",
    annualIncome: "",
    bankName: "",
    bankAccountNo: "",
    bankIfsc: "",
    secondLanguage: "",
    thirdLanguage: "",
    hobbies: "",
  };
}

function extraFromStudent(s: SisStudent): StudentExtraFields {
  return {
    caste: s.caste,
    admissionClass: s.admissionClass,
    admissionFormNo: s.admissionFormNo,
    registrationNo: s.registrationNo,
    tcNo: s.tcNo,
    previousSchoolClass: s.previousSchoolClass,
    previousSchoolYear: s.previousSchoolYear,
    permanentAddress: s.permanentAddress,
    permanentCity: s.permanentCity,
    permanentState: s.permanentState,
    permanentPincode: s.permanentPincode,
    transportRoute: s.transportRoute,
    heightCm: s.heightCm,
    weightKg: s.weightKg,
    isCwsn: s.isCwsn,
    disabilityDetails: s.disabilityDetails,
    medicalNotes: s.medicalNotes,
    fatherOccupation: s.fatherOccupation,
    motherOccupation: s.motherOccupation,
    fatherQualification: s.fatherQualification,
    motherQualification: s.motherQualification,
    annualIncome: s.annualIncome,
    bankName: s.bankName,
    bankAccountNo: s.bankAccountNo,
    bankIfsc: s.bankIfsc,
    secondLanguage: s.secondLanguage,
    thirdLanguage: s.thirdLanguage,
    hobbies: s.hobbies,
  };
}

export function StudentForm({
  mode,
  studentId,
}: {
  mode: "create" | "edit";
  studentId?: string;
}) {
  const router = useRouter();
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [academicYearCode, setAcademicYearCode] = useState(
    session.academicYearCode,
  );
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("basic");

  const [admissionNo, setAdmissionNo] = useState("");
  const [legacyErpAdmissionNo, setLegacyErpAdmissionNo] = useState("");
  const [importedViaLegacyList, setImportedViaLegacyList] = useState(false);
  const [systemAdmissionPending, setSystemAdmissionPending] = useState(false);
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
  const [tagIds, setTagIds] = useState<string[]>([]);

  const [bloodGroup, setBloodGroup] = useState("");
  const [religion, setReligion] = useState("");
  const [category, setCategory] = useState<StudentCategory>("");
  const [nationality, setNationality] = useState("Indian");
  const [motherTongue, setMotherTongue] = useState("");
  const [placeOfBirth, setPlaceOfBirth] = useState("");
  const [aadhaarLast4, setAadhaarLast4] = useState("");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [aadhaarVerification, setAadhaarVerification] =
    useState<AadhaarVerificationStatus>("missing");

  const [fatherName, setFatherName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [fatherMobile, setFatherMobile] = useState("");
  const [motherMobile, setMotherMobile] = useState("");
  const [fatherAadhaarLast4, setFatherAadhaarLast4] = useState("");
  const [motherAadhaarLast4, setMotherAadhaarLast4] = useState("");
  const [fatherAadhaarNumber, setFatherAadhaarNumber] = useState("");
  const [motherAadhaarNumber, setMotherAadhaarNumber] = useState("");
  const [fatherAadhaarVerification, setFatherAadhaarVerification] =
    useState<AadhaarVerificationStatus>("missing");
  const [motherAadhaarVerification, setMotherAadhaarVerification] =
    useState<AadhaarVerificationStatus>("missing");
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
  const [placeGeo, setPlaceGeo] = useState<HouseholdPlaceGeo | null>(null);
  const [linkHouseholdId, setLinkHouseholdId] = useState("");

  const [pen, setPen] = useState("");
  const [penStatus, setPenStatus] = useState<PenStatus>("");
  const [apaarId, setApaarId] = useState("");
  const [srn, setSrn] = useState("");
  const [previousSchool, setPreviousSchool] = useState("");
  const [previousTcNo, setPreviousTcNo] = useState("");
  const [previousUdise, setPreviousUdise] = useState("");
  const [udiseAadhaarValidationStatus, setUdiseAadhaarValidationStatus] =
    useState("");
  const [udiseMbuStatus, setUdiseMbuStatus] = useState("");
  const [udisePortalClassHint, setUdisePortalClassHint] = useState("");
  const [udiseAgeBelowClassAlert, setUdiseAgeBelowClassAlert] = useState(false);
  const [udiseInboundTransferPending, setUdiseInboundTransferPending] =
    useState(false);
  const [udiseComplianceRemindedAt, setUdiseComplianceRemindedAt] =
    useState("");

  const [extra, setExtra] = useState<StudentExtraFields>(emptyExtraFields());
  const setEx = <K extends keyof StudentExtraFields>(
    key: K,
    value: StudentExtraFields[K],
  ) => setExtra((prev) => ({ ...prev, [key]: value }));

  const [docs, setDocs] = useState<StudentDocs>(emptyStudentDocs());
  const [curriculum, setCurriculum] = useState<StudentCurriculum>({
    academicYearCode,
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
      setAcademicYearCode(s.academicYearCode || session.academicYearCode);
      const hh = householdOf(sis, s.householdId);
      setAdmissionNo(s.admissionNo);
      setLegacyErpAdmissionNo(s.legacyErpAdmissionNo || "");
      setImportedViaLegacyList(!!s.importedViaLegacyList);
      setSystemAdmissionPending(!!s.systemAdmissionPending);
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
      setTagIds(s.tagIds ?? []);
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
      setAadhaarNumber(s.aadhaarNumber);
      setAadhaarVerification(s.aadhaarVerification || "missing");
      setFatherName(s.fatherName);
      setMotherName(s.motherName);
      setFatherMobile(s.fatherMobile);
      setMotherMobile(s.motherMobile);
      setFatherAadhaarLast4(s.fatherAadhaarLast4);
      setMotherAadhaarLast4(s.motherAadhaarLast4);
      setFatherAadhaarNumber(s.fatherAadhaarNumber);
      setMotherAadhaarNumber(s.motherAadhaarNumber);
      setFatherAadhaarVerification(s.fatherAadhaarVerification || "missing");
      setMotherAadhaarVerification(s.motherAadhaarVerification || "missing");
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
      setPlaceGeo(hh ? householdPlaceGeoFromRecord(hh) : null);
      setLinkHouseholdId(s.householdId);
      setPen(s.pen);
      setPenStatus(s.penStatus);
      setApaarId(s.apaarId);
      setSrn(s.srn);
      setPreviousSchool(s.previousSchool);
      setPreviousTcNo(s.previousTcNo);
      setPreviousUdise(s.previousUdise);
      setExtra(extraFromStudent(s));
      setUdiseAadhaarValidationStatus(s.udiseAadhaarValidationStatus || "");
      setUdiseMbuStatus(s.udiseMbuStatus || "");
      setUdisePortalClassHint(s.udisePortalClassHint || "");
      setUdiseAgeBelowClassAlert(!!s.udiseAgeBelowClassAlert);
      setUdiseInboundTransferPending(!!s.udiseInboundTransferPending);
      setUdiseComplianceRemindedAt(s.udiseComplianceRemindedAt || "");
      setDocs(normalizeStudentDocs(s.docs));
      return;
    }

    setAdmissionNo(
      suggestAdmissionNo(sis.students, m, session.academicYearCode),
    );
    setLegacyErpAdmissionNo("");
    setImportedViaLegacyList(false);
    setSystemAdmissionPending(false);
    setExtra((prev) => ({
      ...prev,
      registrationNo: suggestRegistrationNo(
        sis.students,
        m,
        session.academicYearCode,
      ),
    }));
    setAcademicYearCode(session.academicYearCode);
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
          academicYearCode: session.academicYearCode,
          curriculum: null,
        },
        m,
      ),
    );
    setPendingRequest(null);
  }, [mode, studentId, session.academicYearCode]);

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
        g.academicYearCode === academicYearCode &&
        types.includes(g.studentType) &&
        (g.classIds.length === 0 ||
          !classId ||
          g.classIds.includes(classId)),
    );
  }, [masters, studentType, classId, academicYearCode]);

  useEffect(() => {
    if (!masters || !classId) return;
    setFeeGroupId((prev) => {
      if (prev && feeGroupsForType.some((g) => g.id === prev)) return prev;
      return (
        resolveFeeGroupId(masters, {
          studentType,
          classId,
          academicYearCode,
          preferPublished: true,
        }) ?? ""
      );
    });
  }, [masters, studentType, classId, feeGroupsForType, academicYearCode]);

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
      guardianPhotoUrl: "",
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
    if (aadhaarVerification !== "verified_udise") {
      const full = aadhaarNumber.replace(/\D/g, "");
      if (full && full.length !== 12) {
        flash("Identity: Student Aadhaar must be 12 digits (or leave blank)");
        setTab("identity");
        return;
      }
    }
    if (aadhaarLast4 && aadhaarLast4.length !== 4) {
      flash("Identity: Aadhaar last 4 must be 4 digits");
      setTab("identity");
      return;
    }
    const penClean = pen.trim();
    if (penClean) {
      if (!previousSchool.trim()) {
        flash(
          "PEN entered: previous school name is required (UDISE+ Drop Box / release)",
        );
        setTab("ids");
        return;
      }
      if (!previousUdise.trim()) {
        flash(
          "PEN entered: previous school UDISE code is required (UDISE+ Drop Box / release)",
        );
        setTab("ids");
        return;
      }
    }
    for (const [label, full, ver] of [
      ["Father Aadhaar", fatherAadhaarNumber, fatherAadhaarVerification],
      ["Mother Aadhaar", motherAadhaarNumber, motherAadhaarVerification],
    ] as const) {
      if (ver === "verified_udise") continue;
      const d = full.replace(/\D/g, "");
      if (d && d.length !== 12) {
        flash(`Family: ${label} must be 12 digits (or leave blank)`);
        setTab("family");
        return;
      }
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
          s.admissionNo.toUpperCase() === nextAdm &&
          s.academicYearCode === academicYearCode &&
          s.id !== studentId,
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
        h.id === householdId
          ? normalizeHousehold({
              ...h,
              ...hhPayload,
              ...(placeGeo ?? {}),
            })
          : h,
      );
    } else {
      const hh: Household = normalizeHousehold({
        id: newSisId("hh"),
        code: `HH-${100 + households.length + 1}`,
        ...hhPayload,
        guardianPhotoUrl: "",
        ...(placeGeo ?? {}),
      });
      households.push(hh);
      householdId = hh.id;
    }

    const nextDocs = syncPhotoDoc(docs, photoUrl.trim());

    const curCheck = validateCurriculum(
      { classId, academicYearCode },
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
      legacyErpAdmissionNo: legacyErpAdmissionNo.trim(),
      importedViaLegacyList,
      systemAdmissionPending,
      fullName: fullName.trim(),
      gender,
      dob,
      campusId,
      classId,
      sectionId,
      rollNo: rollNo.trim(),
      academicYearCode,
      studentType,
      feeGroupId: feeGroupId || null,
      joinedOn: joinedOn.trim(),
      fatherName: fatherName.trim(),
      motherName: motherName.trim(),
      fatherMobile: aligned.fatherMobile,
      motherMobile: aligned.motherMobile,
      fatherAadhaarLast4: (() => {
        const full = fatherAadhaarNumber.replace(/\D/g, "");
        return (
          fatherAadhaarLast4.replace(/\D/g, "").slice(0, 4) || full.slice(-4)
        );
      })(),
      motherAadhaarLast4: (() => {
        const full = motherAadhaarNumber.replace(/\D/g, "");
        return (
          motherAadhaarLast4.replace(/\D/g, "").slice(0, 4) || full.slice(-4)
        );
      })(),
      fatherAadhaarNumber:
        fatherAadhaarVerification === "verified_udise"
          ? ""
          : fatherAadhaarNumber.replace(/\D/g, "").slice(0, 12),
      motherAadhaarNumber:
        motherAadhaarVerification === "verified_udise"
          ? ""
          : motherAadhaarNumber.replace(/\D/g, "").slice(0, 12),
      fatherAadhaarVerification:
        fatherAadhaarVerification === "verified_udise"
          ? "verified_udise"
          : fatherAadhaarNumber.replace(/\D/g, "").length === 12 ||
              fatherAadhaarLast4.length === 4
            ? "received"
            : "missing",
      motherAadhaarVerification:
        motherAadhaarVerification === "verified_udise"
          ? "verified_udise"
          : motherAadhaarNumber.replace(/\D/g, "").length === 12 ||
              motherAadhaarLast4.length === 4
            ? "received"
            : "missing",
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
      aadhaarLast4: (() => {
        const full = aadhaarNumber.replace(/\D/g, "");
        return aadhaarLast4.replace(/\D/g, "").slice(0, 4) || full.slice(-4);
      })(),
      aadhaarNumber:
        aadhaarVerification === "verified_udise"
          ? ""
          : aadhaarNumber.replace(/\D/g, "").slice(0, 12),
      aadhaarVerification:
        aadhaarVerification === "verified_udise"
          ? "verified_udise"
          : aadhaarNumber.replace(/\D/g, "").length === 12 ||
              aadhaarLast4.length === 4
            ? "received"
            : "missing",
      pen: pen.trim(),
      penStatus: (() => {
        const p = pen.trim();
        if (!p) return penStatus;
        if (penStatus === "has_pen" || penStatus === "linked") return penStatus;
        return penStatus || "pending_portal";
      })(),
      apaarId: apaarId.trim(),
      srn: srn.trim(),
      previousSchool: previousSchool.trim(),
      previousTcNo: previousTcNo.trim(),
      previousUdise: previousUdise.trim(),
      udiseAadhaarValidationStatus,
      udiseMbuStatus,
      udisePortalClassHint,
      udiseAgeBelowClassAlert,
      udiseInboundTransferPending: (() => {
        const p = pen.trim();
        if (!p) return false;
        const existing =
          mode === "edit" && studentId
            ? sis.students.find((x) => x.id === studentId)
            : null;
        const prevPen = (existing?.pen || "").trim();
        // New PEN at admission / change → wait for Drop Box or previous-school release
        if (mode === "create" || !prevPen || prevPen !== p) return true;
        return !!udiseInboundTransferPending;
      })(),
      udiseComplianceRemindedAt,
      caste: extra.caste.trim(),
      admissionClass: extra.admissionClass.trim(),
      admissionFormNo: extra.admissionFormNo.trim(),
      registrationNo: extra.registrationNo.trim(),
      tcNo: extra.tcNo.trim(),
      previousSchoolClass: extra.previousSchoolClass.trim(),
      previousSchoolYear: extra.previousSchoolYear.trim(),
      permanentAddress: extra.permanentAddress.trim(),
      permanentCity: extra.permanentCity.trim(),
      permanentState: extra.permanentState.trim(),
      permanentPincode: extra.permanentPincode.replace(/\D/g, "").slice(0, 6),
      transportRoute: extra.transportRoute.trim(),
      heightCm: extra.heightCm.trim(),
      weightKg: extra.weightKg.trim(),
      isCwsn: extra.isCwsn,
      disabilityDetails: extra.disabilityDetails.trim(),
      medicalNotes: extra.medicalNotes.trim(),
      fatherOccupation: extra.fatherOccupation.trim(),
      motherOccupation: extra.motherOccupation.trim(),
      fatherQualification: extra.fatherQualification.trim(),
      motherQualification: extra.motherQualification.trim(),
      annualIncome: extra.annualIncome.trim(),
      bankName: extra.bankName.trim(),
      bankAccountNo: extra.bankAccountNo.trim(),
      bankIfsc: extra.bankIfsc.trim().toUpperCase(),
      secondLanguage: extra.secondLanguage.trim(),
      thirdLanguage: extra.thirdLanguage.trim(),
      hobbies: extra.hobbies.trim(),
      docs: nextDocs,
      notes: notes.trim(),
      tagIds,
      photoUrl: photoUrl.trim() || nextDocs.photo.fileUrl,
      status: mode === "edit" ? status : "active",
      curriculum: confirmCurriculum(
        { ...curriculum, academicYearCode },
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

    bumpStudentSeriesUses(payload, academicYearCode);

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
              <StudentNameLabel
                student={{
                  fullName: fullName || "Edit student",
                  studentType,
                  tagIds,
                }}
              />
            ) : (
              "Add student"
            )}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {academicYearCode} · Student profile · {draftCompleteness}% complete
          </p>
        </div>
        {notice ? (
          <span className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
            {notice}
          </span>
        ) : null}
      </div>

      <ModuleTabs
        aria-label="Student form sections"
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        items={[
          { id: "basic", label: "Basic", tone: "navy" },
          { id: "subjects", label: "Subjects", tone: "teal" },
          { id: "identity", label: "Identity", tone: "sky" },
          { id: "family", label: "Family", tone: "violet" },
          { id: "ids", label: "IDs", tone: "amber" },
          { id: "docs", label: "Documents", tone: "green" },
        ]}
      />

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
              <Field label="Admission no (system)">
                <input
                  className="field"
                  value={admissionNo}
                  onChange={(e) => setAdmissionNo(e.target.value)}
                  required
                  readOnly={importedViaLegacyList && !systemAdmissionPending}
                />
              </Field>
              {importedViaLegacyList ? (
                <Field label="Old ERP admission no. (import only)">
                  <input
                    className="field bg-[rgba(32,48,80,0.04)]"
                    value={legacyErpAdmissionNo}
                    readOnly
                  />
                </Field>
              ) : null}
              {systemAdmissionPending ? (
                <p className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  System admission pending — duplicate name on import. Verify on{" "}
                  <strong>Students → Roster</strong> to assign a unique number.
                </p>
              ) : null}
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
                          academicYearCode,
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
                        suggestFeeStudentType(
                          next,
                          academicYearCode,
                          studentType,
                        ),
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
            <Field label="Tags (show before name)">
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(() => {
                  const tags = listStudentTags();
                  if (!tags.length) {
                    return (
                      <span className="text-xs text-[var(--muted)]">
                        Create tags under Students → Tags
                      </span>
                    );
                  }
                  return tags.map((t) => {
                    const on = tagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setTagIds((prev) =>
                            on
                              ? prev.filter((id) => id !== t.id)
                              : [...prev, t.id],
                          )
                        }
                        className={`rounded px-2 py-1 text-[10px] font-bold text-white ${
                          on
                            ? "ring-2 ring-[var(--brand-deep)] ring-offset-1"
                            : "opacity-45"
                        }`}
                        style={{ background: t.color }}
                        title={t.name}
                      >
                        {t.code}
                      </button>
                    );
                  });
                })()}
              </div>
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
                academicYearCode,
                curriculum,
              }}
              masters={masters}
              curriculum={curriculum}
              onChange={setCurriculum}
              mode="office"
            />
            <p className="mt-3 text-[11px] text-[var(--muted)]">
              Saving the student form confirms these subjects for{" "}
              {academicYearCode}.
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
              <Field label="Caste">
                <input
                  className="field"
                  value={extra.caste}
                  onChange={(e) => setEx("caste", e.target.value)}
                  placeholder="e.g. Brahman, Ahir, Rajput"
                />
              </Field>
              <Field label="Height (cm)">
                <input
                  className="field"
                  value={extra.heightCm}
                  onChange={(e) => setEx("heightCm", e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Weight (kg)">
                <input
                  className="field"
                  value={extra.weightKg}
                  onChange={(e) => setEx("weightKg", e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Special needs (CWSN / Divyang)">
                <select
                  className="field"
                  value={extra.isCwsn ? "yes" : "no"}
                  onChange={(e) => setEx("isCwsn", e.target.value === "yes")}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </Field>
              {extra.isCwsn ? (
                <Field label="Disability details">
                  <input
                    className="field"
                    value={extra.disabilityDetails}
                    onChange={(e) =>
                      setEx("disabilityDetails", e.target.value)
                    }
                    placeholder="Type / % as per certificate"
                  />
                </Field>
              ) : null}
              <Field label="Medical condition / notes">
                <input
                  className="field"
                  value={extra.medicalNotes}
                  onChange={(e) => setEx("medicalNotes", e.target.value)}
                  placeholder="Allergies, chronic condition (if any)"
                />
              </Field>
              <Field label="Second language">
                <input
                  className="field"
                  value={extra.secondLanguage}
                  onChange={(e) => setEx("secondLanguage", e.target.value)}
                  placeholder="e.g. Hindi"
                />
              </Field>
              <Field label="Third language">
                <input
                  className="field"
                  value={extra.thirdLanguage}
                  onChange={(e) => setEx("thirdLanguage", e.target.value)}
                  placeholder="e.g. Sanskrit"
                />
              </Field>
              <Field label="Hobbies / interests">
                <input
                  className="field"
                  value={extra.hobbies}
                  onChange={(e) => setEx("hobbies", e.target.value)}
                  placeholder="e.g. Drawing, Cricket"
                />
              </Field>
              <Field
                label={
                  aadhaarVerification === "verified_udise"
                    ? "Aadhaar — verified by UDISE+ (last 4 only)"
                    : "Student Aadhaar (full — visible until UDISE+ verified)"
                }
              >
                {aadhaarVerification === "verified_udise" ? (
                  <div className="space-y-1">
                    <input
                      className="field"
                      value={displayAadhaar({
                        last4: aadhaarLast4,
                        verification: "verified_udise",
                      })}
                      readOnly
                    />
                    <p className="text-[11px] text-[var(--muted)]">
                      Masked after UDISE+ verification. Change status below to
                      re-enter if needed.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <input
                      className="field font-mono"
                      value={aadhaarNumber}
                      onChange={(e) => {
                        const d = e.target.value.replace(/\D/g, "").slice(0, 12);
                        setAadhaarNumber(d);
                        if (d.length === 12) setAadhaarLast4(d.slice(-4));
                      }}
                      inputMode="numeric"
                      maxLength={12}
                      placeholder={
                        aadhaarLast4
                          ? `On file (UDISE+): xxxx-xxxx-${aadhaarLast4} · enter full 12 digits`
                          : "12-digit Aadhaar"
                      }
                    />
                    {aadhaarLast4 && !aadhaarNumber ? (
                      <p className="text-[11px] text-[#0a4a73]">
                        Aadhaar on file (from UDISE+): last 4 ={" "}
                        <span className="font-mono font-semibold">
                          {aadhaarLast4}
                        </span>
                        . Full number not stored — add all 12 digits to complete.
                      </p>
                    ) : null}
                  </div>
                )}
              </Field>
              <Field label="Aadhaar UDISE+ status">
                <select
                  className="field"
                  value={aadhaarVerification}
                  onChange={(e) => {
                    const v = e.target.value as AadhaarVerificationStatus;
                    setAadhaarVerification(v);
                    if (v === "verified_udise") {
                      const l4 =
                        aadhaarLast4 || aadhaarNumber.replace(/\D/g, "").slice(-4);
                      setAadhaarLast4(l4);
                      setAadhaarNumber("");
                    }
                  }}
                >
                  <option value="missing">Missing</option>
                  <option value="received">Received (pending UDISE verify)</option>
                  <option value="verified_udise">Verified on UDISE+</option>
                </select>
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
              <Field
                label={
                  fatherAadhaarVerification === "verified_udise"
                    ? "Father Aadhaar (verified — last 4)"
                    : "Father Aadhaar (full — for APAAR)"
                }
              >
                {fatherAadhaarVerification === "verified_udise" ? (
                  <input
                    className="field"
                    readOnly
                    value={displayAadhaar({
                      last4: fatherAadhaarLast4,
                      verification: "verified_udise",
                    })}
                  />
                ) : (
                  <input
                    className="field font-mono"
                    value={fatherAadhaarNumber}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, "").slice(0, 12);
                      setFatherAadhaarNumber(d);
                      if (d.length === 12) setFatherAadhaarLast4(d.slice(-4));
                    }}
                    inputMode="numeric"
                    maxLength={12}
                    placeholder="12-digit Aadhaar"
                  />
                )}
              </Field>
              <Field label="Father Aadhaar status">
                <select
                  className="field"
                  value={fatherAadhaarVerification}
                  onChange={(e) => {
                    const v = e.target.value as AadhaarVerificationStatus;
                    setFatherAadhaarVerification(v);
                    if (v === "verified_udise") {
                      setFatherAadhaarLast4(
                        fatherAadhaarLast4 ||
                          fatherAadhaarNumber.replace(/\D/g, "").slice(-4),
                      );
                      setFatherAadhaarNumber("");
                    }
                  }}
                >
                  <option value="missing">Missing</option>
                  <option value="received">Received</option>
                  <option value="verified_udise">Verified</option>
                </select>
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
              <Field label="Father occupation">
                <input
                  className="field"
                  value={extra.fatherOccupation}
                  onChange={(e) => setEx("fatherOccupation", e.target.value)}
                />
              </Field>
              <Field label="Father qualification">
                <input
                  className="field"
                  value={extra.fatherQualification}
                  onChange={(e) => setEx("fatherQualification", e.target.value)}
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
              <Field
                label={
                  motherAadhaarVerification === "verified_udise"
                    ? "Mother Aadhaar (verified — last 4)"
                    : "Mother Aadhaar (full — for APAAR)"
                }
              >
                {motherAadhaarVerification === "verified_udise" ? (
                  <input
                    className="field"
                    readOnly
                    value={displayAadhaar({
                      last4: motherAadhaarLast4,
                      verification: "verified_udise",
                    })}
                  />
                ) : (
                  <input
                    className="field font-mono"
                    value={motherAadhaarNumber}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, "").slice(0, 12);
                      setMotherAadhaarNumber(d);
                      if (d.length === 12) setMotherAadhaarLast4(d.slice(-4));
                    }}
                    inputMode="numeric"
                    maxLength={12}
                    placeholder="12-digit Aadhaar"
                  />
                )}
              </Field>
              <Field label="Mother Aadhaar status">
                <select
                  className="field"
                  value={motherAadhaarVerification}
                  onChange={(e) => {
                    const v = e.target.value as AadhaarVerificationStatus;
                    setMotherAadhaarVerification(v);
                    if (v === "verified_udise") {
                      setMotherAadhaarLast4(
                        motherAadhaarLast4 ||
                          motherAadhaarNumber.replace(/\D/g, "").slice(-4),
                      );
                      setMotherAadhaarNumber("");
                    }
                  }}
                >
                  <option value="missing">Missing</option>
                  <option value="received">Received</option>
                  <option value="verified_udise">Verified</option>
                </select>
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
              <Field label="Mother occupation">
                <input
                  className="field"
                  value={extra.motherOccupation}
                  onChange={(e) => setEx("motherOccupation", e.target.value)}
                />
              </Field>
              <Field label="Mother qualification">
                <input
                  className="field"
                  value={extra.motherQualification}
                  onChange={(e) => setEx("motherQualification", e.target.value)}
                />
              </Field>
              <Field label="Family income / year (₹)">
                <input
                  className="field"
                  value={extra.annualIncome}
                  onChange={(e) => setEx("annualIncome", e.target.value)}
                  inputMode="numeric"
                  placeholder="For EWS / RTE / scholarships"
                />
              </Field>
            </div>

            <div className="mt-4 border-t border-[rgba(32,48,80,0.08)] pt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Bank account (scholarships / DBT)
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Bank name">
                  <input
                    className="field"
                    value={extra.bankName}
                    onChange={(e) => setEx("bankName", e.target.value)}
                  />
                </Field>
                <Field label="Account number">
                  <input
                    className="field"
                    value={extra.bankAccountNo}
                    onChange={(e) => setEx("bankAccountNo", e.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="IFSC">
                  <input
                    className="field uppercase"
                    value={extra.bankIfsc}
                    onChange={(e) => setEx("bankIfsc", e.target.value)}
                    maxLength={11}
                    placeholder="e.g. SBIN0001234"
                  />
                </Field>
              </div>
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
                      setPlaceGeo(householdPlaceGeoFromRecord(hh));
                    } else {
                      setPlaceGeo(null);
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
                <AddressAutocompleteField
                  value={address}
                  onChange={(v) => {
                    setAddress(v);
                    setPlaceGeo(null);
                  }}
                  onResolved={(place) => {
                    setAddress(place.address);
                    if (place.locality) setLocality(place.locality);
                    if (place.landmark) setLandmark(place.landmark);
                    if (place.city) setCity(place.city);
                    if (place.state) setStateName(place.state);
                    if (place.pincode) setPincode(place.pincode);
                    setPlaceGeo(householdGeoFromPlace(place));
                  }}
                  placeholder="Search Google Maps — house, colony, landmark…"
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
                Pick a Google suggestion to pin the home on the map for transport
                planner. Locality + landmark still help match bus stops.
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
                Permanent / native address
              </div>
              <Field label="Permanent address">
                <input
                  className="field"
                  value={extra.permanentAddress}
                  onChange={(e) => setEx("permanentAddress", e.target.value)}
                  placeholder="Leave blank if same as above"
                />
              </Field>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Permanent city">
                  <input
                    className="field"
                    value={extra.permanentCity}
                    onChange={(e) => setEx("permanentCity", e.target.value)}
                  />
                </Field>
                <Field label="Permanent state">
                  <input
                    className="field"
                    value={extra.permanentState}
                    onChange={(e) => setEx("permanentState", e.target.value)}
                  />
                </Field>
                <Field label="Permanent PIN">
                  <input
                    className="field"
                    value={extra.permanentPincode}
                    onChange={(e) =>
                      setEx(
                        "permanentPincode",
                        e.target.value.replace(/\D/g, "").slice(0, 6),
                      )
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
              UDISE PEN, APAAR, SRN and previous-school details. Student Aadhaar
              verification does{" "}
              <strong className="font-semibold">not</strong> auto-create APAAR —
              parent Aadhaar is also required on UDISE+. PEN locks once student
              Aadhaar is verified and PEN is on file; APAAR locks only after the
              APAAR ID is filled.
            </p>
            {aadhaarVerification === "verified_udise" ? (
              <p className="mb-3 rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-xs text-[#0f7a4c]">
                Student Aadhaar verified by UDISE+
                {pen.trim()
                  ? " — PEN is read-only."
                  : " — generate / sync PEN from portal."}
                {!apaarId.trim()
                  ? " APAAR still needs parent Aadhaar + generation on UDISE+ (not automatic)."
                  : " APAAR is on file and read-only."}
              </p>
            ) : null}
            {udiseAgeBelowClassAlert ? (
              <p className="mb-3 rounded-lg border border-[#b42318] bg-[rgba(180,35,24,0.12)] px-3 py-2 text-xs font-semibold text-[#b42318]">
                Notify school: student age is below for this class (govt MBU
                Pending). MBU: {udiseMbuStatus || "Pending"}.
                {udisePortalClassHint
                  ? ` UDISE+ class shown as “${udisePortalClassHint}” (SIS class is not changed from UDISE+).`
                  : " SIS class is not changed from UDISE+ uploads."}
              </p>
            ) : null}
            {udiseInboundTransferPending && pen.trim() ? (
              <p className="mb-3 rounded-lg border border-[#8a5a10] bg-[rgba(138,90,16,0.12)] px-3 py-2 text-xs font-semibold text-[#8a5a10]">
                UDISE+ action required: import this student from Drop Box, or
                send a release request to the previous school on the UDISE+
                portal
                {previousSchool.trim()
                  ? ` (${previousSchool}${previousUdise.trim() ? ` · UDISE ${previousUdise}` : ""})`
                  : ""}
                . Indication clears automatically when this student appears in a
                re-imported Students_Details file.
              </p>
            ) : null}
            {(udiseAadhaarValidationStatus ||
              udiseMbuStatus ||
              udisePortalClassHint) &&
            !udiseAgeBelowClassAlert ? (
              <p className="mb-3 rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-[11px] text-[var(--brand-deep)]">
                {udiseAadhaarValidationStatus
                  ? `Aadhaar validation (UDISE+): ${udiseAadhaarValidationStatus}. `
                  : ""}
                {udiseMbuStatus ? `MBU: ${udiseMbuStatus}. ` : ""}
                {udisePortalClassHint
                  ? `UDISE+ class (reference only): ${udisePortalClassHint}.`
                  : ""}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={
                  aadhaarVerification === "verified_udise" && pen.trim()
                    ? "PEN — no edit required"
                    : "PEN (if already has PEN from previous school)"
                }
              >
                <input
                  className="field"
                  value={pen}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPen(v);
                    if (v.trim() && !udiseInboundTransferPending) {
                      setUdiseInboundTransferPending(true);
                    }
                    if (!v.trim()) setUdiseInboundTransferPending(false);
                  }}
                  placeholder="Leave blank if fresh UDISE registration"
                  readOnly={
                    aadhaarVerification === "verified_udise" && !!pen.trim()
                  }
                  disabled={
                    aadhaarVerification === "verified_udise" && !!pen.trim()
                  }
                />
              </Field>
              <Field label="PEN status">
                <select
                  className="field"
                  value={penStatus}
                  onChange={(e) => setPenStatus(e.target.value as PenStatus)}
                  disabled={
                    aadhaarVerification === "verified_udise" && !!pen.trim()
                  }
                >
                  {PEN_STATUSES.map((p) => (
                    <option key={p.value || "none"} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={
                  apaarId.trim()
                    ? "APAAR ID — on file (read-only)"
                    : "APAAR ID (needs parent Aadhaar on UDISE+)"
                }
              >
                <input
                  className="field"
                  value={apaarId}
                  onChange={(e) => setApaarId(e.target.value)}
                  placeholder={
                    apaarId.trim()
                      ? undefined
                      : "Empty until parent Aadhaar + UDISE+ APAAR generation"
                  }
                  readOnly={!!apaarId.trim()}
                  disabled={!!apaarId.trim()}
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
              <Field
                label={
                  pen.trim()
                    ? "Previous school name (required with PEN)"
                    : "Previous school"
                }
              >
                <input
                  className="field"
                  value={previousSchool}
                  onChange={(e) => setPreviousSchool(e.target.value)}
                  placeholder={
                    pen.trim() ? "School that holds this PEN on UDISE+" : ""
                  }
                  required={!!pen.trim()}
                />
              </Field>
              <Field label="Previous school class">
                <input
                  className="field"
                  value={extra.previousSchoolClass}
                  onChange={(e) =>
                    setEx("previousSchoolClass", e.target.value)
                  }
                />
              </Field>
              <Field label="Previous school year">
                <input
                  className="field"
                  value={extra.previousSchoolYear}
                  onChange={(e) => setEx("previousSchoolYear", e.target.value)}
                  placeholder="e.g. 2024-25"
                />
              </Field>
              <Field label="Previous TC no.">
                <input
                  className="field"
                  value={previousTcNo}
                  onChange={(e) => setPreviousTcNo(e.target.value)}
                />
              </Field>
              <Field
                label={
                  pen.trim()
                    ? "Previous school UDISE code (required with PEN)"
                    : "Previous school UDISE"
                }
              >
                <input
                  className="field"
                  value={previousUdise}
                  onChange={(e) => setPreviousUdise(e.target.value)}
                  placeholder={
                    pen.trim() ? "e.g. 09674104900" : "UDISE code of previous school"
                  }
                  required={!!pen.trim()}
                />
              </Field>
            </div>
            {pen.trim() ? (
              <p className="mt-3 text-[11px] text-[var(--muted)]">
                With PEN: complete previous school name + UDISE code, then either
                pull the student from UDISE+ Drop Box or ask that school to
                release on the portal. After release, re-import Students_Details
                — the Drop Box indication clears when this student is found.
              </p>
            ) : null}

            <div className="mt-4 border-t border-[rgba(32,48,80,0.08)] pt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Admission & school records
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Registration number">
                  <input
                    className="field"
                    value={extra.registrationNo}
                    onChange={(e) => setEx("registrationNo", e.target.value)}
                    placeholder="e.g. 2025-2026/205"
                  />
                </Field>
                <Field label="Admission form no.">
                  <input
                    className="field"
                    value={extra.admissionFormNo}
                    onChange={(e) => setEx("admissionFormNo", e.target.value)}
                  />
                </Field>
                <Field label="Admission class (at first admission)">
                  <input
                    className="field"
                    value={extra.admissionClass}
                    onChange={(e) => setEx("admissionClass", e.target.value)}
                  />
                </Field>
                <Field label="TC number (issued on leaving)">
                  <input
                    className="field"
                    value={extra.tcNo}
                    onChange={(e) => setEx("tcNo", e.target.value)}
                  />
                </Field>
                <Field label="Transport route">
                  <input
                    className="field"
                    value={extra.transportRoute}
                    onChange={(e) => setEx("transportRoute", e.target.value)}
                    placeholder="Bus route name (Transport module owns routing)"
                  />
                </Field>
              </div>
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
              disabled={readOnly}
              className="btn-accent rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {readOnly
                ? "Session closed — read-only"
                : mode === "edit"
                  ? "Save profile"
                  : "Save & continue profile"}
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
