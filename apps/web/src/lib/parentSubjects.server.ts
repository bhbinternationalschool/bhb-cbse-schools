/**
 * The parent portal's Subjects tab, on the server.
 *
 * The tab used to read the SIS roster and Masters in the browser — both refuse
 * a parent session — and to "send" a subject-change request by writing it into
 * this browser's copy of the SIS, which the office never received. Here the
 * children are the session's household's only, the school structure the
 * subject picker needs (classes, subjects, class–subject links, senior
 * streams) is sent as data, and a request is validated with the same CBSE rules
 * the office uses and written to `curriculum_requests`, where the office's
 * Students → Subjects review reads it.
 */
import "server-only";

import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisStudent } from "@/lib/sis";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  fetchCurriculumRemoteServer,
  pushCurriculumStateServer,
} from "@/lib/curriculum.server";
import {
  classGroupForStudent,
  curriculumChoiceMode,
  defaultCurriculum,
  normalizeCurriculum,
  normalizeCurriculumRequest,
  resolveStudentSubjects,
  validateCurriculum,
  type CurriculumRequest,
  type StudentCurriculum,
} from "@/lib/studentCurriculum";

export type ParentSubjectsChild = {
  id: string;
  fullName: string;
  admissionNo: string;
  classId: string;
  classLabel: string;
  academicYearCode: string;
  choiceMode: ReturnType<typeof curriculumChoiceMode>;
  confirmed: { id: string; code: string; nameEn: string }[];
  draft: StudentCurriculum;
  pending: { id: string; requestedAt: string; note: string } | null;
};

export type ParentSubjectsView = {
  children: ParentSubjectsChild[];
  /** The school structure the picker needs — no staff, no fees, no people. */
  masters: Pick<
    MastersState,
    "classes" | "subjects" | "classSubjects" | "seniorStreams" | "academicYears"
  >;
};

type Read =
  | { ok: true; view: ParentSubjectsView }
  | { ok: false; status: number; error: string };

/** One row per child (this session's row, else the newest), as /api/v1/profile does. */
function familyChildren(householdId: string, sessionAy: string): SisStudent[] {
  const byAdmission = new Map<string, SisStudent>();
  for (const s of loadSis().students) {
    if (s.householdId !== householdId || s.status !== "active") continue;
    const key = s.admissionNo || s.id;
    const prev = byAdmission.get(key);
    if (
      !prev ||
      s.academicYearCode === sessionAy ||
      (prev.academicYearCode !== sessionAy &&
        s.academicYearCode > prev.academicYearCode)
    ) {
      byAdmission.set(key, s);
    }
  }
  return [...byAdmission.values()];
}

async function inputs() {
  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  const masters = loadMasters();
  const remote = await fetchCurriculumRemoteServer();
  return { sis, masters, remote };
}

/** The student with the curriculum the database holds for them, when it holds one. */
function withCurriculum(
  s: SisStudent,
  remote: Awaited<ReturnType<typeof fetchCurriculumRemoteServer>>,
): SisStudent {
  const cur = remote?.byStudentKey[s.id];
  return cur
    ? {
        ...s,
        curriculum:
          normalizeCurriculum(cur, s.academicYearCode) ?? s.curriculum,
      }
    : s;
}

export async function readParentSubjects(
  householdId: string,
  sessionAy: string,
): Promise<Read> {
  const { sis, masters, remote } = await inputs();
  if (sis.households.length === 0 || !remote) {
    return {
      ok: false,
      status: 503,
      error: "School records are unavailable right now",
    };
  }
  if (!sis.households.some((h) => h.id === householdId)) {
    return {
      ok: false,
      status: 404,
      error:
        "Your family's record was not found — please contact the school office",
    };
  }
  const classLabel = (s: SisStudent) => {
    const cls = masters.classes.find((c) => c.id === s.classId)?.name ?? "";
    const sec = masters.sections.find((x) => x.id === s.sectionId)?.name ?? "";
    return sec ? `${cls}-${sec}` : cls || "—";
  };
  const children = familyChildren(householdId, sessionAy).map((raw) => {
    const s = withCurriculum(raw, remote);
    const pending =
      remote.requests.find(
        (r) => r.studentId === s.id && r.status === "pending",
      ) ?? null;
    return {
      id: s.id,
      fullName: s.fullName,
      admissionNo: s.admissionNo,
      classId: s.classId,
      classLabel: classLabel(s),
      academicYearCode: s.academicYearCode,
      choiceMode: curriculumChoiceMode(classGroupForStudent(s, masters)),
      confirmed: resolveStudentSubjects(s, masters).map((x) => ({
        id: x.id,
        code: x.code,
        nameEn: x.nameEn,
      })),
      draft: defaultCurriculum(s, masters),
      pending: pending
        ? {
            id: pending.id,
            requestedAt: pending.requestedAt,
            note: pending.note,
          }
        : null,
    };
  });
  return {
    ok: true,
    view: {
      children,
      masters: {
        classes: masters.classes,
        subjects: masters.subjects,
        classSubjects: masters.classSubjects,
        seniorStreams: masters.seniorStreams,
        academicYears: masters.academicYears,
      },
    },
  };
}

export async function submitParentSubjectRequest(input: {
  householdId: string;
  studentId: string;
  proposedStreamId: string | null;
  proposedChosenSubjectIds: string[];
  note: string;
}): Promise<
  | { ok: true; request: CurriculumRequest }
  | { ok: false; status: number; error: string }
> {
  const { sis, masters, remote } = await inputs();
  if (!remote)
    return {
      ok: false,
      status: 503,
      error: "Could not save just now — try again",
    };
  const student = sis.students.find((s) => s.id === input.studentId);
  if (!student) return { ok: false, status: 404, error: "Student not found" };
  // The household is the session's: another family's child is refused.
  if (student.householdId !== input.householdId)
    return { ok: false, status: 403, error: "Not your child" };
  if (curriculumChoiceMode(classGroupForStudent(student, masters)) === "none") {
    return {
      ok: false,
      status: 400,
      error: "This class has a fixed subject set — no choice to request",
    };
  }
  if (
    remote.requests.some(
      (r) => r.studentId === student.id && r.status === "pending",
    )
  ) {
    return {
      ok: false,
      status: 409,
      error: "A subject change request is already pending office review",
    };
  }
  const draft: StudentCurriculum = {
    ...defaultCurriculum(withCurriculum(student, remote), masters),
    seniorStreamId: input.proposedStreamId,
    chosenSubjectIds: [
      ...new Set(
        input.proposedChosenSubjectIds.filter((x) => typeof x === "string"),
      ),
    ],
  };
  const check = validateCurriculum(student, draft, masters);
  if (!check.ok)
    return {
      ok: false,
      status: 400,
      error: check.errors[0] ?? "Those choices are not allowed",
    };

  const request = normalizeCurriculumRequest({
    id: `creq_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    studentId: student.id,
    academicYearCode: student.academicYearCode,
    proposedStreamId: draft.seniorStreamId,
    proposedChosenSubjectIds: draft.chosenSubjectIds,
    note: input.note.slice(0, 500),
    status: "pending",
    requestedAt: new Date().toISOString(),
  });
  const saved = await pushCurriculumStateServer({
    students: [],
    curriculumRequests: [request],
  });
  if (!saved.ok)
    return {
      ok: false,
      status: 503,
      error: "Could not save just now — try again",
    };
  return { ok: true, request };
}
