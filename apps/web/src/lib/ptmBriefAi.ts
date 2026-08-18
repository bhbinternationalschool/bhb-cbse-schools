/**
 * PTM per-student brief — the three paragraphs a class teacher wants in
 * front of them *before* a parent sits down: what we've observed, what
 * concerns us, what we suggest. Pure helpers shared by the PTM Feedback
 * tab (which assembles facts from data the browser already holds) and the
 * server route (prompt + parse).
 *
 * Same rules as report remarks and lesson plans:
 *  - The model sees only `PtmBriefFacts`: first name, class, up to two
 *    exam terms, attendance %, homework submission ratio, discipline
 *    counts, prior PTM notes. No ids, no contact details.
 *  - Absent data is passed as absent and the prompt says "do not comment"
 *    — a family must never hear "attendance is fine" when we simply have
 *    no register for that section.
 *  - Nothing is saved by the route. The brief is a preparation aid; the
 *    teacher copies what they want into the meeting feedback.
 */

export type PtmBriefLanguage = "en" | "hi";

export type PtmBriefTermFact = {
  label: string;
  percent: number;
  overallGrade: string;
  subjects: {
    subjectName: string;
    marksObtained: number | null;
    maxMarks: number;
    grade: string;
  }[];
};

export type PtmBriefFacts = {
  studentId: string;
  firstName: string;
  classLabel: string;
  /** Oldest first, at most 2 */
  terms: PtmBriefTermFact[];
  attendancePercent: number | null;
  /** Homework posts that required a submission and are past due, this AY */
  homework: { assigned: number; submitted: number } | null;
  discipline: {
    incidents: number;
    meritPoints: number;
    demeritPoints: number;
    /** Most recent first, at most 3 */
    recent: { date: string; categoryLabel: string; escalationLabel: string }[];
  } | null;
  /** Earlier PTM notes, most recent first, at most 3 */
  priorFeedback: { date: string; strengths: string; areas: string; followUp: string }[];
  /** Free instruction from the teacher */
  teacherNote: string;
};

export type PtmBriefDraft = {
  observations: string;
  concerns: string;
  suggestions: string;
};

export function buildPtmBriefSystemPrompt(opts: {
  language: PtmBriefLanguage;
  schoolName: string;
}): string {
  const lang =
    opts.language === "hi"
      ? "Write in Hindi (Devanagari), formal register (आप), the way a class teacher would speak to a parent. Keep subject names in Hindi where a standard name exists (गणित, विज्ञान, अंग्रेज़ी, हिंदी, सामाजिक विज्ञान)."
      : "Write in clear, warm, plain English the way a class teacher speaks to a parent.";
  return `You prepare a class teacher at ${opts.schoolName} (a CBSE school in India) for a parent-teacher meeting about one student. The teacher will read this before the parent arrives and may read parts of it aloud.

${lang}

Write exactly three short paragraphs (3–5 sentences each):
1. observations — what the data shows: performance across the terms given (mention the trend if two terms are given), attendance if given, homework habit if given, conduct if given, and anything a previous PTM noted. Lead with a genuine strength.
2. concerns — the one or two things that most need the parent's attention. Be specific (subject, number) and calm. If nothing is concerning, say so plainly in one or two sentences instead of inventing a concern.
3. suggestions — 2–4 concrete, doable things for home and school for the coming weeks, tied to the concerns. Offer to follow up.

Rules:
- Use only the facts given. If attendance, homework, discipline or a previous term is marked "not available", do not mention it at all — do not say it is fine, do not say it is missing.
- Never invent marks, dates, incidents or quotes. Do not diagnose (no "dyslexia", "ADHD" etc.). No comparisons with other students.
- Use the student's first name. No greeting, no sign-off, no headings, no markdown, no bullet symbols.
- If the teacher gave a note, follow it.

Respond with JSON only, exactly: {"observations":"…","concerns":"…","suggestions":"…"} — three keys, strings only.`;
}

export function buildPtmBriefUserPrompt(f: PtmBriefFacts): string {
  const L: string[] = [];
  L.push(`Student: ${f.firstName}${f.classLabel ? ` · Class ${f.classLabel}` : ""}`);
  L.push("");
  if (f.terms.length === 0) {
    L.push("Exam results: not available");
  } else {
    L.push("Exam results (oldest first):");
    for (const t of f.terms) {
      L.push(`- ${t.label}: ${t.percent}% overall, grade ${t.overallGrade}`);
      for (const s of t.subjects) {
        L.push(
          `    ${s.subjectName}: ${
            s.marksObtained == null ? "absent/no mark" : `${s.marksObtained}/${s.maxMarks}`
          } (${s.grade})`,
        );
      }
    }
  }
  L.push("");
  L.push(
    f.attendancePercent == null
      ? "Attendance: not available"
      : `Attendance this year: ${f.attendancePercent}%`,
  );
  L.push(
    f.homework == null
      ? "Homework: not available"
      : f.homework.assigned === 0
        ? "Homework: no submissions were due yet"
        : `Homework submitted: ${f.homework.submitted} of ${f.homework.assigned} due`,
  );
  if (f.discipline == null) {
    L.push("Conduct log: not available");
  } else if (f.discipline.incidents === 0) {
    L.push("Conduct log: no incidents recorded this year");
  } else {
    L.push(
      `Conduct log: ${f.discipline.incidents} incident(s) this year · merit points ${f.discipline.meritPoints} · demerit points ${f.discipline.demeritPoints}`,
    );
    for (const r of f.discipline.recent) {
      L.push(
        `    ${r.date}: ${r.categoryLabel}${r.escalationLabel && r.escalationLabel !== "None" ? ` (${r.escalationLabel})` : ""}`,
      );
    }
  }
  if (f.priorFeedback.length) {
    L.push("");
    L.push("Earlier PTM notes (most recent first):");
    for (const p of f.priorFeedback) {
      const parts: string[] = [];
      if (p.strengths) parts.push(`strengths: ${p.strengths}`);
      if (p.areas) parts.push(`areas: ${p.areas}`);
      if (p.followUp) parts.push(`follow-up: ${p.followUp}`);
      L.push(`- ${p.date}: ${parts.join("; ") || "(no notes)"}`);
    }
  }
  if (f.teacherNote.trim()) {
    L.push("");
    L.push(`Teacher's note: ${f.teacherNote.trim()}`);
  }
  return L.join("\n");
}

export function parsePtmBriefJson(text: string): PtmBriefDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (k: string) =>
    String(r[k] ?? "")
      .replace(/\r\n/g, "\n")
      .trim()
      .slice(0, 1500);
  const d = { observations: s("observations"), concerns: s("concerns"), suggestions: s("suggestions") };
  if (!d.observations || !d.suggestions) return null;
  return d;
}

/** Sanitise a client payload; null when there is nothing to brief on. */
export function cleanPtmBriefFacts(raw: unknown): PtmBriefFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const studentId = str(r.studentId, 60);
  const firstName = str(r.firstName, 40);
  if (!studentId || !firstName) return null;

  const terms = Array.isArray(r.terms)
    ? r.terms
        .map((t) => {
          const x = (t ?? {}) as Record<string, unknown>;
          const label = str(x.label, 60);
          const percent = num(x.percent);
          if (!label || percent == null) return null;
          const subjects = Array.isArray(x.subjects)
            ? x.subjects
                .map((s) => {
                  const y = (s ?? {}) as Record<string, unknown>;
                  const subjectName = str(y.subjectName, 60);
                  if (!subjectName) return null;
                  return {
                    subjectName,
                    marksObtained: num(y.marksObtained),
                    maxMarks: num(y.maxMarks) ?? 100,
                    grade: str(y.grade, 4) || "—",
                  };
                })
                .filter((s): s is NonNullable<typeof s> => !!s)
                .slice(0, 20)
            : [];
          return {
            label,
            percent: Math.round(percent * 10) / 10,
            overallGrade: str(x.overallGrade, 4) || "—",
            subjects,
          };
        })
        .filter((t): t is NonNullable<typeof t> => !!t)
        .slice(-2)
    : [];

  const hw = (r.homework ?? null) as Record<string, unknown> | null;
  const homework =
    hw && typeof hw === "object" && num(hw.assigned) != null && num(hw.submitted) != null
      ? {
          assigned: Math.max(0, Math.floor(num(hw.assigned)!)),
          submitted: Math.max(0, Math.floor(num(hw.submitted)!)),
        }
      : null;

  const dc = (r.discipline ?? null) as Record<string, unknown> | null;
  const discipline =
    dc && typeof dc === "object" && num(dc.incidents) != null
      ? {
          incidents: Math.max(0, Math.floor(num(dc.incidents)!)),
          meritPoints: Math.max(0, Math.floor(num(dc.meritPoints) ?? 0)),
          demeritPoints: Math.max(0, Math.floor(num(dc.demeritPoints) ?? 0)),
          recent: Array.isArray(dc.recent)
            ? dc.recent
                .map((i) => {
                  const y = (i ?? {}) as Record<string, unknown>;
                  return {
                    date: str(y.date, 10),
                    categoryLabel: str(y.categoryLabel, 40),
                    escalationLabel: str(y.escalationLabel, 40),
                  };
                })
                .filter((i) => i.date && i.categoryLabel)
                .slice(0, 3)
            : [],
        }
      : null;

  const priorFeedback = Array.isArray(r.priorFeedback)
    ? r.priorFeedback
        .map((p) => {
          const y = (p ?? {}) as Record<string, unknown>;
          return {
            date: str(y.date, 10),
            strengths: str(y.strengths, 300),
            areas: str(y.areas, 300),
            followUp: str(y.followUp, 300),
          };
        })
        .filter((p) => p.date && (p.strengths || p.areas || p.followUp))
        .slice(0, 3)
    : [];

  const attendancePercent = num(r.attendancePercent);
  const facts: PtmBriefFacts = {
    studentId,
    firstName,
    classLabel: str(r.classLabel, 20),
    terms,
    attendancePercent:
      attendancePercent == null ? null : Math.round(attendancePercent * 10) / 10,
    homework,
    discipline,
    priorFeedback,
    teacherNote: str(r.teacherNote, 500),
  };
  // Nothing at all to talk about → no LLM call.
  if (
    terms.length === 0 &&
    attendancePercent == null &&
    !homework &&
    !discipline &&
    priorFeedback.length === 0 &&
    !facts.teacherNote
  ) {
    return null;
  }
  return facts;
}
