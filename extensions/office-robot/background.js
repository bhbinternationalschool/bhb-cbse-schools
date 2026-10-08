/*
 * BHB Office Robot — background worker.
 *
 * Does nothing on its own. It only answers the panel on the portal page when
 * a person clicks: it forwards that click's data to the ERP, or fetches the
 * ERP's details for the child whose form is open. No timers, no alarms.
 *
 * The ERP login is the office's own session cookie in this browser; the robot
 * holds no password and no key. A 401 means "log in to the ERP in this
 * Chrome", never a stored credential.
 */

const DEFAULT_ERP = "https://bhbinternational.school";

// The only fields of a portal record that leave the portal tab. Kept in step
// with UDISE_PORTAL_FIELDS in apps/web/src/lib/udisePortalApi.ts; the server
// applies its own copy too, so a drift here can only ever send less.
const PORTAL_FIELDS = [
  "studentId", "studentName", "gender", "dob", "classId", "classDesc", "sectionDesc",
  "studentCodeNat", "studentCodeState", "fatherName", "motherName", "guardianName",
  "socCatId", "minorityId", "isBplYN", "aayBplYN", "ewsYN", "cwsnYN", "natIndYN",
  "ooscYN", "isRepeater", "disabilityCerti", "impairmentPercent", "formStatus", "uuid",
  "nameAsUuid", "uuidStatus", "uuidStatusDesc", "apaarId", "apaarIdStatusDesc",
  "mbuStatusDesc", "primaryMobile", "secondaryMobile", "email", "address", "pincode",
  "motherTongueDesc", "bloodGroup", "admnNumber",
];

// The only fields of a UDISE+ Teacher-module row that leave the portal tab —
// no Aadhaar, no mobile. Kept in step with PORTAL_TEACHER_FIELDS in
// apps/web/src/lib/udiseTeacherFill.ts (the server re-applies its own copy).
const TEACHER_FIELDS = [
  "empStaffId", "nationalCode", "staffName", "gender", "dateOfBirth",
  "dateOfJoiningInService", "dateOfJoiningInPresentSchool", "natureOfAppointment",
  "typeOfTeacher", "classTaught", "academicQualification", "professionalQualification",
  "socialCategory", "mainSubject1", "email",
];

// A teacher's GP / AT / TD form answers that may leave the portal tab (the
// two-way sync, 7 Oct 2026) — staff mobile and email yes, Aadhaar never.
// Kept in step with PORTAL_FORM_FIELDS in apps/web/src/lib/udiseTeacherSync.ts.
const TEACHER_FORM_FIELDS = {
  gp: ["empName", "gender", "dob", "empCodeState", "socialCat", "qualAcad", "trade", "mathUpto", "scienceUpto",
    "englishUpto", "socStudyUpto", "langStudyUpto", "qualProf", "mobile", "email", "disabilityType"],
  at: ["natureOfAppt", "dojService", "dojPs", "tchType", "docPh", "classTaught", "appointedLevel", "apptSub",
    "subTaught1", "subTaught2"],
  td: ["trainedCwsn", "trainedComp", "trgNishtha", "isCtetStet", "nontchDays", "trngRcvd", "trngNeeded"],
};

// What the APAAR queue needs of a portal child — no Aadhaar, no mobile.
const APAAR_FIELDS = [
  "studentId", "studentName", "studentCodeNat", "classId", "sectionId",
  "uuidStatus", "apaarId", "apaarIdStatusDesc",
];

const pick = (rec, keys) => {
  const out = {};
  for (const k of keys) if (rec && k in rec) out[k] = rec[k];
  return out;
};

// One ERP, matching the manifest's only host permission. For local testing,
// add the localhost origin to host_permissions and change this line.
async function erpBase() {
  return DEFAULT_ERP;
}

async function erpFetch(path, init = {}) {
  const base = await erpBase();
  let res;
  try {
    res = await fetch(base + path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Could not reach the ERP at ${base} (${e && e.message ? e.message : e})` };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 401) return { ok: false, status: 401, error: `Not logged in to the ERP. Open ${base} in this Chrome, log in, then click again.` };
  if (res.status === 403) return { ok: false, status: 403, error: (body && body.error) || "Your ERP login lacks Compliance · edit." };
  if (!res.ok) return { ok: false, status: res.status, error: (body && body.error) || `ERP error ${res.status}` };
  return { ok: true, status: res.status, body };
}

function pickFields(rec) {
  const out = {};
  for (const k of PORTAL_FIELDS) if (rec && k in rec) out[k] = rec[k];
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg && msg.type === "pull") {
      const res = await erpFetch("/api/v1/udise/robot/sync", {
        method: "POST",
        body: JSON.stringify({
          academicYearCode: msg.academicYearCode,
          students: (msg.students || []).map(pickFields),
        }),
      });
      const at = new Date().toISOString();
      await chrome.storage.local.set({
        lastPull: res.ok ? { at, ok: true, ...res.body } : { at, ok: false, error: res.error },
      });
      reply(res);
    } else if (msg && msg.type === "whoami") {
      reply(await erpFetch("/api/v1/udise/robot/sync"));
    } else if (msg && msg.type === "add-list") {
      // Only what the ERP needs to tell who is already on the portal.
      const students = (msg.students || []).map((p) => ({
        studentName: p.studentName,
        dob: p.dob,
        fatherName: p.fatherName,
        motherName: p.motherName,
        primaryMobile: p.primaryMobile,
        studentCodeNat: p.studentCodeNat,
      }));
      reply(await erpFetch("/api/v1/udise/robot/add-list", { method: "POST", body: JSON.stringify({ students }) }));
    } else if (msg && msg.type === "teachers-board") {
      reply(
        await erpFetch("/api/v1/udise/robot/teachers", {
          method: "POST",
          body: JSON.stringify({
            teachers: (msg.teachers || []).map((t) => ({ ...pick(t, TEACHER_FIELDS), staffType: t.staffType === "non_teaching" ? "non_teaching" : "teaching" })),
            nonTeachingRead: msg.nonTeachingRead === true,
          }),
        }),
      );
    } else if (msg && msg.type === "teacher-fill") {
      const q = new URLSearchParams({ code: msg.code || "", form: msg.form || "", name: msg.name || "", dob: msg.dob || "" });
      reply(await erpFetch(`/api/v1/udise/robot/teacher-fill?${q}`));
    } else if (msg && msg.type === "teacher-details") {
      // null stays null: "this form was not read" is not "this form is blank".
      const form = (rec, f) => (rec && typeof rec === "object" ? pick(rec, TEACHER_FORM_FIELDS[f]) : null);
      reply(
        await erpFetch("/api/v1/udise/robot/teacher-details", {
          method: "POST",
          body: JSON.stringify({
            listsRead: {
              teaching: !!(msg.listsRead && msg.listsRead.teaching),
              non_teaching: !!(msg.listsRead && msg.listsRead.non_teaching),
            },
            teachers: (msg.teachers || []).map((t) => ({
              staffType: t.staffType === "non_teaching" ? "non_teaching" : "teaching",
              list: pick(t.list, TEACHER_FIELDS),
              gp: form(t.gp, "gp"),
              at: form(t.at, "at"),
              td: form(t.td, "td"),
            })),
          }),
        }),
      );
    } else if (msg && msg.type === "teacher-add") {
      reply(await erpFetch(`/api/v1/udise/robot/teacher-add?staffId=${encodeURIComponent(msg.staffId || "")}`));
    } else if (msg && msg.type === "apaar-queue") {
      reply(
        await erpFetch("/api/v1/udise/robot/apaar-queue", {
          method: "POST",
          body: JSON.stringify({ students: (msg.students || []).map((s) => pick(s, APAAR_FIELDS)) }),
        }),
      );
    } else if (msg && msg.type === "apaar-fill") {
      reply(await erpFetch(`/api/v1/udise/robot/apaar-fill?pen=${encodeURIComponent(msg.pen || "")}`));
    } else if (msg && msg.type === "student-details") {
      // Each child's full portal record; the server keeps only its whitelist
      // (lib/udisePortalStudentSync) and never an Aadhaar number.
      reply(
        await erpFetch("/api/v1/udise/robot/student-details", {
          method: "POST",
          body: JSON.stringify({ academicYearCode: msg.academicYearCode, students: msg.students || [] }),
        }),
      );
    } else if (msg && msg.type === "student-enrolment") {
      reply(
        await erpFetch("/api/v1/udise/robot/student-enrolment", {
          method: "POST",
          body: JSON.stringify({ academicYearCode: msg.academicYearCode, pen: msg.pen, studentId: msg.studentId, ep: msg.ep || {} }),
        }),
      );
    } else if (msg && msg.type === "students-check") {
      // Only PEN, name and birth date of the children listed on the page.
      const rows = (msg.rows || []).map((r) => ({ pen: r.pen || "", name: r.name || "", dob: r.dob || "" }));
      reply(await erpFetch("/api/v1/udise/robot/students-check", { method: "POST", body: JSON.stringify({ rows }) }));
    } else if (msg && msg.type === "transfers-in") {
      reply(await erpFetch("/api/v1/udise/robot/transfers-in"));
    } else if (msg && msg.type === "pen-search-list") {
      reply(await erpFetch("/api/v1/udise/robot/pen-search-list"));
    } else if (msg && msg.type === "pen-candidates") {
      reply(await erpFetch("/api/v1/udise/robot/pen-candidates", { method: "POST", body: JSON.stringify({ results: msg.results || [] }) }));
    } else if (msg && msg.type === "profile-send") {
      // UDISE+ School Profile (profile.udiseplus.gov.in): one section's boxes
      // as the page shows them — school-level answers, no child's data. The
      // server normalises and caps every field again.
      reply(
        await erpFetch("/api/v1/udise/robot/school-profile", {
          method: "POST",
          body: JSON.stringify({
            academicYear: msg.academicYear,
            section: msg.section,
            fields: msg.fields,
            formStatus: msg.formStatus,
            text: msg.text,
          }),
        }),
      );
    } else if (msg && msg.type === "profile-plan") {
      const q = new URLSearchParams({ section: msg.section || "", ay: msg.academicYear || "" });
      reply(await erpFetch(`/api/v1/udise/robot/school-profile?${q}`));
    } else if (msg && msg.type === "fill-data") {
      reply(await erpFetch(`/api/v1/udise/robot/fill?pen=${encodeURIComponent(msg.pen || "")}&v=2`));
    } else {
      reply({ ok: false, error: "Unknown request" });
    }
  })();
  return true;
});
