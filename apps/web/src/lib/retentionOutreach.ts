/**
 * Retention outreach — the parent-facing message for a student the
 * academic early-warning rules flagged. Deterministic text in the
 * household's language (no model: this is a meeting invitation, not an
 * assessment), sent by the teacher / coordinator over WhatsApp and logged
 * nowhere automatic — the PTM / follow-up is the record. Attendance,
 * safety and fee messages have their own flows; this is only "let's talk
 * about progress before it becomes a problem".
 */

import { householdLanguage, type HouseholdPrefsLike } from "@/lib/householdPrefs";

export function retentionOutreachText(opts: {
  schoolName: string;
  parentName: string;
  childName: string;
  classLabel: string;
  termLabel: string;
  teacherName: string;
  household: HouseholdPrefsLike;
}): { text: string; language: string } {
  const { language } = householdLanguage(opts.household, "en");
  const parent = opts.parentName || (language === "en" ? "Parent" : "अभिभावक");
  if (language === "hi" || language === "bho" || language === "mai") {
    return {
      language: "hi",
      text: `नमस्ते ${parent} जी,\n${opts.schoolName} से ${opts.teacherName || "कक्षा शिक्षक"} बोल रहा/रही हूँ। ${opts.childName} (${opts.classLabel}) की ${opts.termLabel} की प्रगति पर हम आपसे कुछ मिनट बात करना चाहेंगे, ताकि मिलकर सहयोग कर सकें। कृपया बताइए कि फ़ोन पर या स्कूल में मिलने के लिए कौन सा समय आपके लिए सही रहेगा। धन्यवाद।`,
    };
  }
  if (language === "ur") {
    return {
      language: "ur",
      text: `السلام علیکم ${parent} صاحب/صاحبہ،\n${opts.schoolName} سے ${opts.teacherName || "کلاس ٹیچر"} بات کر رہا/رہی ہوں۔ ${opts.childName} (${opts.classLabel}) کی ${opts.termLabel} کی پیش رفت پر ہم آپ سے چند منٹ بات کرنا چاہیں گے تاکہ مل کر مدد کر سکیں۔ براہِ کرم بتائیں کہ فون یا اسکول میں ملاقات کے لیے کون سا وقت مناسب رہے گا۔ شکریہ۔`,
    };
  }
  if (language === "bn") {
    return {
      language: "bn",
      text: `নমস্কার ${parent},\n${opts.schoolName} থেকে ${opts.teacherName || "ক্লাস টিচার"} বলছি। ${opts.childName} (${opts.classLabel})-এর ${opts.termLabel}-এর অগ্রগতি নিয়ে আমরা আপনার সঙ্গে কয়েক মিনিট কথা বলতে চাই, যাতে একসঙ্গে সাহায্য করতে পারি। ফোনে বা স্কুলে দেখা করার জন্য কোন সময় আপনার সুবিধাজনক, জানাবেন। ধন্যবাদ।`,
    };
  }
  return {
    language: "en",
    text: `Dear ${parent},\nThis is ${opts.teacherName || "the class teacher"} from ${opts.schoolName}. We would like a few minutes with you about ${opts.childName}'s (${opts.classLabel}) progress in ${opts.termLabel}, so we can support them together. Please tell us a convenient time for a call or a short meeting at school. Thank you.`,
  };
}
