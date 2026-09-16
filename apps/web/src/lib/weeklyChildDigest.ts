/**
 * "Your child this week" — one WhatsApp message per family, on Saturday.
 *
 * WHY (2026-09-16): in the 30 days to this date the school sent parents
 * 1,126 fee reminders, 117 bus-pin requests, 84 receipts — and not one
 * message about their child. 78% of everything a parent heard from us was
 * about money, and 89 approved templates (attendance, exams, homework, PTM)
 * had never been used once. This is the message that changes what the school
 * sounds like.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a line only appears when the school
 * actually knows the answer. No zeros standing in for "not recorded", no
 * "0 days absent" for a week nobody marked the register, no "no homework"
 * when homework simply is not tracked. A parent must be able to trust every
 * line, which means a quiet week is a shorter message, not a fuller one.
 *
 * Meta rejects a template parameter containing a newline, a tab, or four
 * consecutive spaces, so every value here is ONE line — `digestVariables`
 * is the only thing allowed to produce them, and its self-test holds that
 * down.
 */

export type DigestAttendance = {
  /** School days in the week that actually had a register. 0 = not marked. */
  markedDays: number;
  present: number;
  absent: number;
  leave: number;
  late: number;
};

export type DigestMark = {
  subject: string;
  scored: number;
  outOf: number;
  /** Exam / test name as the office entered it. */
  examName: string;
};

export type DigestChild = {
  studentId: string;
  name: string;
  classLabel: string;
  /** null = the register was never marked this week; do not claim anything. */
  attendance: DigestAttendance | null;
  /** Empty = nothing published this week, which is not the same as zero marks. */
  marks: DigestMark[];
  /** Fee dues for this child, in paise. null = not computed / unknown. */
  duePaise: number | null;
};

export type DigestFamily = {
  householdId: string;
  guardianName: string;
  mobile: string;
  hindi: boolean;
  children: DigestChild[];
};

function inr(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

/** One line, always — Meta refuses a parameter with a newline in it. */
function oneLine(parts: (string | null | undefined)[], join = " · "): string {
  return parts
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(join)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\t/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
}

/**
 * Attendance in one line, or null when the register was not marked.
 *
 * "0 absent" and "nobody marked the register" look identical to a parent and
 * mean opposite things, so the second says nothing at all.
 */
export function attendanceLine(
  a: DigestAttendance | null,
  hindi: boolean,
): string | null {
  if (!a || a.markedDays <= 0) return null;
  if (hindi) {
    return oneLine([
      `${a.present}/${a.markedDays} दिन उपस्थित`,
      a.absent > 0 ? `${a.absent} दिन अनुपस्थित` : null,
      a.leave > 0 ? `${a.leave} दिन अवकाश` : null,
      a.late > 0 ? `${a.late} दिन देर से` : null,
    ]);
  }
  return oneLine([
    `Present ${a.present} of ${a.markedDays} days`,
    a.absent > 0 ? `absent ${a.absent}` : null,
    a.leave > 0 ? `leave ${a.leave}` : null,
    a.late > 0 ? `late ${a.late}` : null,
  ]);
}

/** Marks in one line, or null when nothing was published this week. */
export function marksLine(marks: DigestMark[], hindi: boolean): string | null {
  const real = (marks ?? []).filter((m) => m.outOf > 0 && m.subject.trim());
  if (real.length === 0) return null;
  const shown = real.slice(0, 4);
  const body = shown
    .map((m) => `${m.subject} ${m.scored}/${m.outOf}`)
    .join(", ");
  const more = real.length - shown.length;
  if (hindi) {
    return oneLine([body, more > 0 ? `और ${more} विषय` : null], " · ");
  }
  return oneLine([body, more > 0 ? `and ${more} more` : null], " · ");
}

/**
 * Fees in one line.
 *
 * "Nothing pending" is worth saying — it is the one line a parent who has
 * paid wants to see, and it costs the school nothing to say thank you.
 * Unknown stays silent.
 */
export function feeLine(duePaise: number | null, hindi: boolean): string | null {
  if (duePaise === null) return null;
  if (duePaise <= 0) {
    return hindi ? "कुछ भी बकाया नहीं — धन्यवाद 🙏" : "Nothing pending — thank you 🙏";
  }
  return hindi ? `${inr(duePaise)} बकाया` : `${inr(duePaise)} pending`;
}

/**
 * The child line: "Aarav (Class III A) — Present 5 of 6 days · Hindi 18/20".
 *
 * One line per child so a family with three children gets one message, not
 * three. A child the school knows nothing about this week is left out
 * entirely rather than padded.
 */
export function childLine(child: DigestChild, hindi: boolean): string | null {
  const facts = oneLine(
    [
      attendanceLine(child.attendance, hindi),
      marksLine(child.marks, hindi),
      feeLine(child.duePaise, hindi),
    ],
    " · ",
  );
  if (!facts) return null;
  return oneLine([`${child.name} (${child.classLabel})`, facts], " — ");
}

export type DigestVariables = {
  guardianName: string;
  weekLabel: string;
  childSummary: string;
  /** "" when the family has nothing to report — the caller must not send. */
  empty: boolean;
};

/**
 * The template's variables, all single-line, or `empty` when there is
 * nothing true to say. A family with no news gets NO message: an empty
 * digest is worse than silence, because it teaches parents to ignore the
 * next one.
 */
export function digestVariables(
  family: DigestFamily,
  weekLabel: string,
): DigestVariables {
  const lines = (family.children ?? [])
    .map((c) => childLine(c, family.hindi))
    .filter((l): l is string => !!l);

  const childSummary = oneLine(lines, "  |  ");
  return {
    guardianName: (family.guardianName || "").trim() || (family.hindi ? "अभिभावक" : "Parent"),
    weekLabel,
    childSummary,
    empty: childSummary.length === 0,
  };
}

/**
 * The same thing as free text, for a family already inside the 24-hour
 * window — no template, no conversation charge, and it can use real line
 * breaks because free text has none of the template restrictions.
 */
export function digestFreeText(family: DigestFamily, weekLabel: string): string {
  const hindi = family.hindi;
  const lines = (family.children ?? [])
    .map((c) => childLine(c, hindi))
    .filter((l): l is string => !!l);
  if (lines.length === 0) return "";

  const head = hindi
    ? `🗓️ *इस सप्ताह आपके बच्चे* · ${weekLabel}`
    : `🗓️ *Your child this week* · ${weekLabel}`;
  const foot = hindi
    ? "कोई सवाल हो तो इसी संदेश का उत्तर दें 🙏"
    : "Reply to this message with any question 🙏";
  return [head, "", ...lines.map((l) => `• ${l}`), "", foot].join("\n");
}
