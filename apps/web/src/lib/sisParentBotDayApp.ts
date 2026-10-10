/**
 * Two questions parents ask the WhatsApp bot every week that it used to
 * pass to the office as "I don't have this information" (director, 10 Oct
 * 2026): "is school open today / is it a holiday?" and "how do I download
 * the app?". Both have answers the ERP already holds — the published
 * holiday calendar, per class, and the Play Store listing. Pure.
 */

import { PARENT_APP_URL } from "@/lib/classGroupMoveNotice";

/** iPhone has no store app; the parent web app installs from Safari. */
export const PARENT_WEB_APP_URL = "https://bhbinternational.school/parent";

const HOLIDAY_WORD =
  /\b(chh?utt?i|chhuti|chuti|holiday|leave\s*hai|band|bandh|closed?|khula|khuli|khulega|khulegi|open)\b|छुट्टी|छुट्टि|छुटी|अवकाश|बंद|खुला|खुली|खुलेगा|खुलेगी/i;
const SCHOOL_GOING =
  /\bschool\s*(aa|aana|ana|jana|jaana|lagega|lagegi|chalega|chalegi|hai|h|hoga|hogi)\b|स्कूल\s*(आना|जाना|लगेगा|चलेगा|है|होगा)|\b(aa|aana|jana|jaana|bhejna|bhejen|bheje|bhejein)\b.*\bschool\b|भेजना|भेजें/i;
const TODAY = /\b(aaj|aj|today|abhi)\b|आज/i;
const TOMORROW = /\b(kal|kl|tomorrow|tmrw|tomorow)\b|कल/i;
const DAY_AFTER = /\b(parso|parson|day after tomorrow)\b|परसों/i;
// Questions about a child's own absence are leave requests, not this.
const CHILD_LEAVE = /\b((leave|chh?utt?i|chhuti|chuti)\s*(chahiye|chaahiye|chaiye|de|dena|dijiye|dijie|application|lena|leni)|absent\s*rahega|nahi\s*aayega|nahi\s*ayega)\b|छुट्टी\s*(चाहिए|दे|दें|दीजिए)|नहीं\s*आएगा/i;
// Fee "chhoot" (a discount) is not a holiday.
const DISCOUNT = /discount|concession|छूट|माफ/i;

export type SchoolDayQuestion = { dateIso: string; which: "today" | "tomorrow" | "day_after" };

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "aaj chutti hai kya", "kal school khulega?", "is school open today" → which day. */
export function detectSchoolDayQuestion(text: string, todayIso: string): SchoolDayQuestion | null {
  const t = text.trim();
  if (!t || t.length > 200 || CHILD_LEAVE.test(t) || DISCOUNT.test(t)) return null;
  const holidayish = HOLIDAY_WORD.test(t);
  const schoolish = SCHOOL_GOING.test(t);
  const day = DAY_AFTER.test(t) ? "day_after" : TOMORROW.test(t) ? "tomorrow" : TODAY.test(t) ? "today" : null;
  // "school band hai?" / "aaj chutti?" / "kal school lagega?" — a holiday
  // word alone, or going-to-school with a day.
  if (!holidayish && !(schoolish && day)) return null;
  if (!holidayish && !day) return null;
  const which = day ?? "today";
  return { which, dateIso: addDays(todayIso, which === "today" ? 0 : which === "tomorrow" ? 1 : 2) };
}

export type ChildDay = {
  name: string;
  className: string;
  status: "working" | "holiday" | "half_holiday";
  /** Holiday title when not a working day. */
  title: string;
  /** Next working day for this child when today is off ("" if none found). */
  nextWorkingIso: string;
};

const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_HI = ["जनवरी", "फरवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

export function dayLabel(iso: string, hindi: boolean): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const w = d.getUTCDay();
  const m = d.getUTCMonth();
  return hindi ? `${WEEKDAY_HI[w]}, ${d.getUTCDate()} ${MONTH_HI[m]}` : `${WEEKDAY_EN[w]}, ${d.getUTCDate()} ${MONTH_EN[m]}`;
}

function whichWord(which: SchoolDayQuestion["which"], hindi: boolean): string {
  if (hindi) return which === "today" ? "आज" : which === "tomorrow" ? "कल" : "परसों";
  return which === "today" ? "Today" : which === "tomorrow" ? "Tomorrow" : "The day after tomorrow";
}

function childLine(c: ChildDay, hindi: boolean): string {
  const who = `*${c.name}*${c.className ? ` (${c.className})` : ""}`;
  if (c.status === "working") return hindi ? `✅ ${who} — स्कूल खुला है` : `✅ ${who} — school is open`;
  const reopen = c.nextWorkingIso
    ? hindi
      ? ` · स्कूल ${dayLabel(c.nextWorkingIso, true)} को खुलेगा`
      : ` · school reopens ${dayLabel(c.nextWorkingIso, false)}`
    : "";
  if (c.status === "half_holiday") return hindi ? `🕐 ${who} — आधे दिन की छुट्टी (${c.title})` : `🕐 ${who} — half day (${c.title})`;
  return hindi ? `🏖️ ${who} — छुट्टी है (${c.title})${reopen}` : `🏖️ ${who} — holiday (${c.title})${reopen}`;
}

export function composeSchoolDayReply(opts: { q: SchoolDayQuestion; children: ChildDay[]; hindi: boolean }): string {
  const { q, children, hindi } = opts;
  const head = `📅 ${whichWord(q.which, hindi)} · ${dayLabel(q.dateIso, hindi)}`;
  if (!children.length) return head;
  const lines = children.map((c) => childLine(c, hindi));
  const foot = hindi
    ? "\n\nयह जानकारी स्कूल के प्रकाशित छुट्टी कैलेंडर से है। किसी बदलाव की सूचना स्कूल अलग से भेजेगा।"
    : "\n\nThis is from the school's published holiday calendar. The school will message you separately about any change.";
  return `${head}\n${lines.join("\n")}${foot}`;
}

// "app" itself; "aap"/"ap" is also the polite "you", so it counts only with
// a download word ("ap download krna hai", never "aap kaise hain").
const APP_WORD =
  /\b(app|apps|aplication|application|apk|play\s*store|playstore)\b|ऐप|एप|एप्प|प्ले\s*स्टोर/i;
const LOOSE_APP_WORD = /\b(aap|ap)\b/i;
const DOWNLOAD_WORD = /\b(download|downlod|dawnload|install|link|login|log\s*in)\b|डाउनलोड|इंस्टॉल|लिंक|लॉगिन/i;
const APP_ASK =
  /\b(download|downlod|dawnload|install|kaise|kese|kaha|kahan|link|chahiye|chaiye|krna|karna|karni|krni|nahi\s*(chal|khul|ho)|open\s*nahi|where|how|get|send|bhejo|bhejiye)\b|डाउनलोड|इंस्टॉल|कैसे|कहाँ|लिंक|चाहिए|करना|भेजें|नहीं\s*(चल|खुल)/i;

/** "ap download krna hai", "app ka link bhejo", "how to install app" — the parent app. */
export function detectAppDownloadQuestion(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 200 || /\b(fee|fees)\b|फीस/i.test(t)) return false;
  if (APP_WORD.test(t)) return APP_ASK.test(t);
  return LOOSE_APP_WORD.test(t) && DOWNLOAD_WORD.test(t);
}

export function composeAppDownloadReply(hindi: boolean): string {
  return hindi
    ? [
        "📱 *BHB School पैरेंट ऐप*",
        "",
        "*Android फ़ोन:*",
        `1. यह लिंक खोलें: ${PARENT_APP_URL}`,
        "2. *Install* दबाएँ",
        "3. ऐप खोलें और *Parent* चुनें",
        "4. स्कूल में दर्ज मोबाइल नंबर डालें (जिस नंबर से आप यह WhatsApp कर रहे हैं) → आए हुए OTP को डालें",
        "",
        `*iPhone:* Safari में ${PARENT_WEB_APP_URL} खोलें → नीचे *Share* (⬆️) → *Add to Home Screen*`,
        "",
        "ऐप में फीस भुगतान, होमवर्क, उपस्थिति, स्कूल सूचनाएँ और बस की जानकारी मिलती है।",
        "OTP न आए या नंबर न चले तो *HUMAN* लिखें — ऑफिस मदद करेगा।",
      ].join("\n")
    : [
        "📱 *BHB School parent app*",
        "",
        "*Android phone:*",
        `1. Open this link: ${PARENT_APP_URL}`,
        "2. Tap *Install*",
        "3. Open the app and choose *Parent*",
        "4. Enter the mobile number registered with the school (the one you are WhatsApping from) → type the OTP you receive",
        "",
        `*iPhone:* open ${PARENT_WEB_APP_URL} in Safari → tap *Share* (⬆️) → *Add to Home Screen*`,
        "",
        "The app has fee payment, homework, attendance, school notices and bus details.",
        "If the OTP does not come or the number is not accepted, reply *HUMAN* and the office will help.",
      ].join("\n");
}
