/**
 * Smart Teach — the publisher's teacher portal (teacher.pinnaclelearning.in).
 *
 * The school's Pinnacle/Lead account carries the ADD-ON books only: Click Code
 * Connect (Computer, 1–8), Know and Grow with Derek (GK, 1–8) and New Longman
 * Vistas (Social Studies, 1–5). Each book there has per-chapter worksheets,
 * answer keys, animations, mind maps and — for Click Code Connect — a lesson
 * plan PDF. The Propel core books (Maths, Science, English, Hindi, Social
 * Science for 6–8) are NOT on the account, so a teacher who follows a link for
 * those subjects would land on a library that has nothing for the lesson.
 *
 * We link out; nothing from the portal is copied into the ERP. The teacher
 * signs in there with their own mobile + OTP.
 */

import { tutorGrade } from "@/lib/tutorSyllabus";

export const SMART_TEACH_URL = "https://teacher.pinnaclelearning.in";

export type SmartTeachBook = {
  /** The book as the portal's library lists it, e.g. "Click Code Connect - 8" */
  book: string;
  /** What the teacher will find inside, for the link's tooltip */
  has: string;
};

/**
 * Which portal book covers this class + subject, or null when the account has
 * none (every core subject, and Social Studies above Class 5).
 *
 * `subjectName` is the Masters label as typed ("Computer", "G.K. / Computer
 * Practical", "Social Studies"); `classLabel` is "VIII", "Class 8", "8 A".
 */
export function smartTeachBookFor(
  classLabel: string | undefined,
  subjectName: string | undefined,
): SmartTeachBook | null {
  const grade = tutorGrade(classLabel);
  if (grade == null) return null; // Nursery–UKG: the account's Tip-Tap-Toe set is not the school's
  const s = (subjectName || "").toLowerCase();
  if (!s.trim()) return null;

  // Order matters: "G.K. / Computer Practical" is the GK paper, not Computer.
  if (/\bg\.? ?k\.?\b|general knowledge|सामान्य ज्ञान/.test(s)) {
    return { book: `Know and Grow with Derek ${grade}`, has: "worksheets, infobytes and answer keys" };
  }
  if (/computer|\bict\b|coding|कंप्यूटर/.test(s)) {
    return {
      book: `Click Code Connect - ${grade}`,
      has: "lesson plans, worksheets, animations and answer keys",
    };
  }
  if (grade <= 5 && /social|\bsst\b|environment|world around|समाज/.test(s)) {
    return { book: `New Longman Vistas ${grade}`, has: "worksheets, animations and answer keys" };
  }
  return null;
}
