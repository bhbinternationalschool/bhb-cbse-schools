/**
 * Homework submitted on WhatsApp, and the teacher's remark coming back.
 *
 * The loop: the homework message tells the family they can send the finished
 * work to the same number; a photo arrives; it is filed against the right
 * child and the right post; the subject teacher gets it with a four-character
 * code; the teacher replies "#A7K2 well done" and the family reads it.
 *
 * Two things this buys beyond convenience.
 *
 * Nobody installs anything. The families who most need to be reached are the
 * ones who never installed the parent app, and they are all already on
 * WhatsApp.
 *
 * And it keeps Meta's 24-hour window open. Free-form text is deliverable only
 * to a family that has messaged the school within the day — which is why this
 * ERP leans on approved templates for everything and waits on Meta's queue to
 * change a sentence. A family that has just sent their child's homework has
 * opened that window themselves, and for the rest of the day the school can
 * simply talk to them.
 *
 * Pure: every rule about what may be claimed, and every word anybody reads.
 */

/* ── the reply code ──────────────────────────────────────────────── */

/**
 * No 0/O, no 1/I/l — a teacher retypes this from a phone screen, often in
 * sunlight, and a code that can be read two ways costs a remark. Same
 * alphabet as the office relay's codes, deliberately: staff learn one shape.
 */
export const SUBMISSION_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const SUBMISSION_CODE_LENGTH = 4;

export function makeSubmissionCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < SUBMISSION_CODE_LENGTH; i += 1) {
    out += SUBMISSION_CODE_ALPHABET[Math.floor(random() * SUBMISSION_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * "#A7K2 well done" → the code and the remark.
 *
 * The same shape the office relay uses, so a teacher who already answers
 * relayed messages does not learn a second syntax. The webhook tries
 * homework codes first and falls through to the relay, because a code that
 * exists in both places must resolve the same way every time rather than
 * depending on which table was read first.
 */
export function parseSubmissionReply(text: string): { code: string; remark: string } | null {
  const m = /^\s*#\s*([0-9A-Za-z]{4})\b[\s:,\-–—]*([\s\S]*)$/.exec(text || "");
  if (!m) return null;
  const code = m[1]!.toUpperCase();
  if (![...code].every((ch) => SUBMISSION_CODE_ALPHABET.includes(ch))) return null;
  return { code, remark: (m[2] || "").replace(/\s+/g, " ").trim() };
}

/* ── which homework is this ──────────────────────────────────────── */

export type SubmittablePost = {
  postId: string;
  studentId: string;
  studentName: string;
  subjectLabel: string;
  title: string;
  /** The post's own date, ISO. Newest first is the caller's job. */
  date: string;
};

export type SubmissionTarget =
  | { kind: "one"; post: SubmittablePost }
  | { kind: "ask"; options: SubmittablePost[] }
  | { kind: "none" };

/**
 * Which post a photograph belongs to.
 *
 * Never a guess. One candidate is obvious; a caption naming exactly one
 * child or one subject decides; anything else asks, because filing a
 * child's work against their sibling's homework is a small humiliation for
 * both of them and the teacher cannot tell it happened.
 *
 * A number on its own ("2") answers the question this asked — that is how
 * the reply comes back, so it is read here too.
 */
export function chooseSubmissionTarget(input: {
  candidates: SubmittablePost[];
  caption: string;
}): SubmissionTarget {
  const candidates = input.candidates;
  if (!candidates.length) return { kind: "none" };
  if (candidates.length === 1) return { kind: "one", post: candidates[0]! };

  const caption = (input.caption || "").trim();

  // "2" — answering the numbered list this sent a moment ago.
  const asNumber = /^([1-9])\b/.exec(caption);
  if (asNumber) {
    const idx = Number(asNumber[1]) - 1;
    if (idx >= 0 && idx < candidates.length) return { kind: "one", post: candidates[idx]! };
  }

  if (caption) {
    const hay = caption.toLowerCase();
    const byChild = candidates.filter((c) => {
      const first = (c.studentName || "").split(/\s+/)[0]?.toLowerCase() ?? "";
      return first.length >= 3 && hay.includes(first);
    });
    if (byChild.length === 1) return { kind: "one", post: byChild[0]! };
    const bySubject = candidates.filter((c) => {
      const s = (c.subjectLabel || "").toLowerCase();
      return s.length >= 4 && hay.includes(s);
    });
    if (bySubject.length === 1) return { kind: "one", post: bySubject[0]! };
    // A child named AND a subject named, where each alone was ambiguous.
    const both = byChild.filter((c) => bySubject.includes(c));
    if (both.length === 1) return { kind: "one", post: both[0]! };
  }

  return { kind: "ask", options: candidates.slice(0, 5) };
}

/* ── what people read ────────────────────────────────────────────── */

export function renderSubmissionAsk(input: { options: SubmittablePost[]; language: "en" | "hi" }): string {
  const lines = input.options.map(
    (o, i) => `${i + 1}. ${o.studentName.split(/\s+/)[0]} — ${o.subjectLabel}${o.title ? `: ${o.title}` : ""}`,
  );
  return input.language === "hi"
    ? `📷 मिल गया, धन्यवाद 🙏\n\nयह किस गृहकार्य का है? नंबर लिखकर भेजें:\n\n${lines.join("\n")}`
    : `📷 Got it, thank you 🙏\n\nWhich homework is this for? Reply with the number:\n\n${lines.join("\n")}`;
}

export function renderSubmissionAck(input: {
  childName: string;
  subjectLabel: string;
  teacherName: string;
  language: "en" | "hi";
}): string {
  const who = input.teacherName || (input.language === "hi" ? "कक्षा शिक्षक" : "the class teacher");
  return input.language === "hi"
    ? `✅ ${input.childName} का ${input.subjectLabel} गृहकार्य मिल गया — धन्यवाद 🙏\n\nयह ${who} को भेज दिया गया है। वे देखकर यहीं उत्तर देंगे।`
    : `✅ Got ${input.childName}'s ${input.subjectLabel} homework — thank you 🙏\n\nIt has gone to ${who}, who will look at it and reply here.`;
}

/** What the subject teacher receives, with the photo attached separately. */
export function renderTeacherPacket(input: {
  childName: string;
  classLabel: string;
  subjectLabel: string;
  title: string;
  code: string;
  submittedAtLabel: string;
  note: string;
}): string {
  const lines = [
    `📷 *Homework submitted* · ${input.childName} (${input.classLabel})`,
    `${input.subjectLabel}${input.title ? ` — ${input.title}` : ""}`,
    `Sent by the family on WhatsApp, ${input.submittedAtLabel}`,
  ];
  if (input.note) lines.push("", `They wrote: "${input.note}"`);
  lines.push(
    "",
    `To reply, send *#${input.code}* and your remark — for example:`,
    `#${input.code} Well done, check question 3 again`,
    "",
    "The family reads it as it is, in this chat. Nothing is marked or graded by this.",
  );
  return lines.join("\n");
}

/** The teacher's own words, to the family. Never rewritten. */
export function renderRemarkToParent(input: {
  childName: string;
  subjectLabel: string;
  teacherName: string;
  remark: string;
  language: "en" | "hi";
}): string {
  const from = input.teacherName || (input.language === "hi" ? "कक्षा शिक्षक" : "the class teacher");
  return input.language === "hi"
    ? `📝 ${input.childName} के ${input.subjectLabel} गृहकार्य पर ${from} का उत्तर:\n\n“${input.remark}”\n\nकुछ पूछना हो तो यहीं लिखिए 🙏`
    : `📝 ${from} on ${input.childName}'s ${input.subjectLabel} homework:\n\n“${input.remark}”\n\nWrite here if you would like to ask anything 🙏`;
}

/** What the teacher is told once their remark has gone. */
export function renderRemarkSent(input: { childName: string; ok: boolean; error?: string }): string {
  return input.ok
    ? `✅ Sent to ${input.childName}'s family.`
    : `⚠️ Could not send that to ${input.childName}'s family${input.error ? ` — ${input.error}` : ""}. The remark is saved on the submission in the ERP.`;
}

/** A code that matched nothing: say so, rather than swallowing the remark. */
export function renderUnknownCode(code: string): string {
  return `I could not find homework for code #${code}. It may have been answered already, or the code may be a few days old — open Homework in the ERP to reply there.`;
}

/**
 * The line in the homework message that invites the work back — one copy,
 * used by the free-text message and matched word for word by the approved
 * template, so a family reading one today and the other tomorrow is not
 * reading two different promises.
 *
 * Offered to every family, not only where the teacher ticked "requires
 * submission": an invitation the school then refuses is worse than none, so
 * `submittablePostsFor` accepts a photograph against the child's most likely
 * recent homework either way.
 */
export function submitInviteLine(language: "en" | "hi"): string {
  return language === "hi"
    ? "✅ पूरा होने पर कॉपी की फ़ोटो इसी नंबर पर भेज दें — वह सीधे विषय शिक्षक तक पहुँचेगी।"
    : "✅ When it is done, send a photo of the work to this number — it goes straight to the subject teacher.";
}
