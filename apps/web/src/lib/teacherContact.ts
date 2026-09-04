/**
 * Parents reaching teachers — the pure rules. Teachers answer between
 * 8 AM and 8 PM IST; outside that, a message is accepted, held, and
 * delivered in the morning, and the parent is told so. Messages travel
 * through the school's WhatsApp number, never to a teacher's own phone
 * from the app, so numbers stay private and the window can be enforced.
 */

export const TEACHER_HOURS = { startMinutes: 8 * 60, endMinutes: 20 * 60 } as const;

export function teacherHoursLabel(): string {
  return "8 AM – 8 PM";
}

/** IST minutes since midnight for an instant. */
function istMinutes(at: Date): number {
  const ist = new Date(at.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function teacherHoursOpen(at = new Date()): boolean {
  const m = istMinutes(at);
  return m >= TEACHER_HOURS.startMinutes && m < TEACHER_HOURS.endMinutes;
}

/** The next 8 AM IST at or after `at`, as an ISO string — when a held message goes out. */
export function nextTeacherWindowOpen(at = new Date()): string {
  const ist = new Date(at.getTime() + 330 * 60_000);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  let openUtc = day + TEACHER_HOURS.startMinutes * 60_000 - 330 * 60_000;
  if (openUtc <= at.getTime() && !teacherHoursOpen(at)) openUtc += 86_400_000;
  if (teacherHoursOpen(at)) return at.toISOString();
  return new Date(openUtc).toISOString();
}

export type TeacherContact = {
  staffId: string;
  name: string;
  /** "Class teacher" or the subject(s) taught to this section. */
  role: string;
  isClassTeacher: boolean;
  subjects: string[];
};

/**
 * The prefilled WhatsApp text a parent sends to the school's number. The
 * `Ref:` line is what the bot reads; everything after the last line is
 * the parent's own words. Kept in the parent's language.
 */
export function buildTeacherWaText(opts: {
  teacherName: string;
  role: string;
  childName: string;
  classLabel: string;
  studentId: string;
  staffId: string;
  hindi?: boolean;
}): string {
  const head = opts.hindi ? "शिक्षक के लिए संदेश" : "Message for teacher";
  const t = opts.hindi ? "शिक्षक" : "Teacher";
  const s = opts.hindi ? "बच्चा" : "Student";
  const hint = opts.hindi ? "(अपना संदेश नीचे लिखें)" : "(type your message below)";
  return [
    head,
    `${t}: ${opts.teacherName} (${opts.role})`,
    `${s}: ${opts.childName} (${opts.classLabel})`,
    `Ref: T:${opts.studentId}:${opts.staffId}`,
    hint,
    "",
  ].join("\n");
}

export type TeacherWaRelay = { studentId: string; staffId: string; message: string };

/**
 * Read a teacher message off an inbound WhatsApp text. Null when the text
 * is not one — so ordinary bot traffic is untouched. The parent's words
 * are whatever follows the template; the hint line is dropped.
 */
export function parseTeacherWaText(text: string): TeacherWaRelay | null {
  const m = text.match(/^Ref:\s*T:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)\s*$/m);
  if (!m) return null;
  const after = text.slice((m.index ?? 0) + m[0].length);
  const message = after
    .split("\n")
    .filter((l) => !/^\((type your message below|अपना संदेश नीचे लिखें)\)\s*$/.test(l.trim()))
    .join("\n")
    .trim();
  return { studentId: m[1]!, staffId: m[2]!, message };
}

/** The text a teacher receives, with enough to answer without opening anything. */
export function buildTeacherForwardText(opts: {
  childName: string;
  classLabel: string;
  guardianName: string;
  guardianMobile: string;
  message: string;
  heldSince?: string | null;
}): string {
  const held = opts.heldSince ? " (sent after hours, delivered this morning)" : "";
  return [
    `Message from the parent of ${opts.childName} (${opts.classLabel})${held}:`,
    "",
    opts.message,
    "",
    `— ${opts.guardianName || "Parent"}${opts.guardianMobile ? ` · ${opts.guardianMobile}` : ""}`,
    "Reply in the app or call the parent. Teachers are contacted 8 AM – 8 PM only.",
  ].join("\n");
}

/** What the parent is told after sending. */
export function teacherRelayAck(opts: { teacherName: string; open: boolean; hindi?: boolean }): string {
  if (opts.open) {
    return opts.hindi
      ? `आपका संदेश ${opts.teacherName} को भेज दिया गया है। शिक्षक सुबह 8 से रात 8 बजे के बीच उत्तर देते हैं।`
      : `Your message has been sent to ${opts.teacherName}. Teachers reply between 8 AM and 8 PM.`;
  }
  return opts.hindi
    ? `शिक्षक सुबह 8 से रात 8 बजे तक उपलब्ध हैं। आपका संदेश सुरक्षित है और सुबह 8 बजे ${opts.teacherName} को पहुँचा दिया जाएगा।`
    : `Teachers are available 8 AM – 8 PM. Your message is saved and will reach ${opts.teacherName} at 8 AM.`;
}
