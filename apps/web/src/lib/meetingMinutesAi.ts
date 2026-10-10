/**
 * Meeting minutes from raw notes / a transcript — shapes, prompt and parser
 * shared by the route and the Document maker. Draft only; the office edits
 * and prints on letterhead. Owners and dates are copied from the notes,
 * never guessed: an action item without a named owner stays unassigned.
 */

export type MinutesLanguage = "en" | "hi" | "both";

export type ActionItem = {
  task: string;
  /** Person / role as named in the notes; "" if none named */
  owner: string;
  /** Free text as said in the meeting ("by Friday", "before PTM"); "" if none */
  due: string;
};

export type MeetingMinutesDraft = {
  title: string;
  /** YYYY-MM-DD if stated in the notes, else "" */
  date: string;
  attendees: string[];
  agenda: string[];
  /** Short paragraphs, one per agenda point discussed */
  discussion: string[];
  decisions: string[];
  actionItems: ActionItem[];
  nextMeeting: string;
  /** Hindi rendering of discussion + decisions when language is hi/both; "" otherwise */
  summaryHi: string;
};

export const MINUTES_MAX_NOTES_CHARS = 20_000;

export function buildMinutesSystemPrompt(opts: { language: MinutesLanguage; schoolName: string }): string {
  const lang =
    opts.language === "hi"
      ? "Write every field in Hindi (Devanagari)."
      : opts.language === "both"
        ? "Write the fields in English and put a faithful Hindi (Devanagari) summary of the discussion and decisions in summaryHi."
        : "Write in plain English; summaryHi must be an empty string.";
  return `You turn raw meeting notes or a transcript from ${opts.schoolName} (a CBSE school in India) into formal minutes.

Rules:
- Use only what the notes say. Never add a decision, an owner, a date or an attendee that is not in the notes. If the notes do not name who will do something, owner is "". If no due date/time was said, due is "".
- Keep the school's own words for names, classes and amounts. Do not resolve disagreements the meeting left open — record them as open points in discussion.
- decisions: only things the meeting actually agreed. actionItems: concrete tasks (verb + object). agenda: the topics in the order they came up (infer headings from the notes if none were given).
- ${lang}

Respond with JSON only, exactly:
{"title":"…","date":"YYYY-MM-DD or empty","attendees":["…"],"agenda":["…"],"discussion":["…"],"decisions":["…"],"actionItems":[{"task":"…","owner":"…","due":"…"}],"nextMeeting":"…","summaryHi":"…"}`;
}

export function buildMinutesUserPrompt(input: {
  title: string;
  date: string;
  attendees: string;
  notes: string;
}): string {
  const L: string[] = [];
  if (input.title.trim()) L.push(`Meeting: ${input.title.trim()}`);
  if (input.date.trim()) L.push(`Date: ${input.date.trim()}`);
  if (input.attendees.trim()) L.push(`Attendees (as entered by the office): ${input.attendees.trim()}`);
  L.push("", "Notes / transcript:", input.notes.trim().slice(0, MINUTES_MAX_NOTES_CHARS));
  return L.join("\n");
}

export function parseMinutesJson(text: string): MeetingMinutesDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 600) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
  const list = (v: unknown, max = 40) =>
    Array.isArray(v) ? v.map((x) => str(x, 600)).filter(Boolean).slice(0, max) : [];
  const actionItems: ActionItem[] = Array.isArray(r.actionItems)
    ? r.actionItems
        .map((a) => {
          const x = (a ?? {}) as Record<string, unknown>;
          const task = str(x.task, 300);
          return task ? { task, owner: str(x.owner, 80), due: str(x.due, 80) } : null;
        })
        .filter((a): a is ActionItem => !!a)
        .slice(0, 40)
    : [];
  const date = str(r.date, 10);
  const draft: MeetingMinutesDraft = {
    title: str(r.title, 160),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
    attendees: list(r.attendees, 60),
    agenda: list(r.agenda, 30),
    discussion: list(r.discussion, 30),
    decisions: list(r.decisions, 30),
    actionItems,
    nextMeeting: str(r.nextMeeting, 200),
    summaryHi: str(r.summaryHi, 4000),
  };
  if (draft.discussion.length === 0 && draft.decisions.length === 0 && draft.actionItems.length === 0) return null;
  return draft;
}

/** Plain-text body for letterhead print / copy. */
export function minutesToBody(m: MeetingMinutesDraft): string {
  const L: string[] = [];
  if (m.date) L.push(`Date: ${m.date}`);
  if (m.attendees.length) L.push(`Present: ${m.attendees.join(", ")}`);
  if (m.agenda.length) {
    L.push("", "Agenda");
    m.agenda.forEach((a, i) => L.push(`${i + 1}. ${a}`));
  }
  if (m.discussion.length) {
    L.push("", "Discussion");
    m.discussion.forEach((d) => L.push(d));
  }
  if (m.decisions.length) {
    L.push("", "Decisions");
    m.decisions.forEach((d, i) => L.push(`${i + 1}. ${d}`));
  }
  if (m.actionItems.length) {
    L.push("", "Action items");
    m.actionItems.forEach((a, i) =>
      L.push(`${i + 1}. ${a.task}${a.owner ? ` — ${a.owner}` : " — (owner not named)"}${a.due ? ` · ${a.due}` : ""}`),
    );
  }
  if (m.nextMeeting) L.push("", `Next meeting: ${m.nextMeeting}`);
  return L.join("\n");
}
