/**
 * School-wide WhatsApp Business template registry (Meta WABA).
 * Store: localStorage `bhb_wa_templates_v1` + Supabase blob `wa_templates_state`.
 */
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const STORAGE_KEY = "bhb_wa_templates_v1";

export type WaTemplateStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "paused";

/** Meta's delivery-quality rating for an approved template (message_template_quality_update). */
export type WaTemplateQuality = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

export type WaTemplateCategory =
  | "UTILITY"
  | "MARKETING"
  | "AUTHENTICATION";

export type WaTemplateLanguage = "en" | "hi";

/**
 * The modules a template can belong to.
 *
 * The LIST is the source and the type is derived from it, not the other way
 * round. A hand-kept copy beside a union drifts, and the drift is invisible:
 * the routing screen would simply not offer the module nobody added to the
 * list, and that module would quietly keep using the default number.
 */
export const WA_TEMPLATE_MODULES = [
  "admissions",
  "fees",
  "attendance",
  "homework",
  "exams",
  "ptm",
  "leave",
  "vault",
  "comms",
  "store",
  "transport",
  "certificates",
  "rte",
  "field",
  "staff",
  "general",
] as const;

export type WaTemplateModule = (typeof WA_TEMPLATE_MODULES)[number];

export type WaHeaderFormat =
  | "NONE"
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT";

export type WaTemplateButton = {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phoneNumber?: string;
};

export type WaCarouselCard = {
  id: string;
  headerFormat: "IMAGE" | "VIDEO" | "NONE";
  mediaUrl?: string;
  /** Original filename for document / image uploads */
  mediaFileName?: string;
  body: string;
  buttons: WaTemplateButton[];
};

export type WaTemplate = {
  id: string;
  /** Groups EN + HI variants */
  familyKey: string;
  name: string;
  module: WaTemplateModule;
  category: WaTemplateCategory;
  language: WaTemplateLanguage;
  status: WaTemplateStatus;
  /** Meta template name (snake_case) */
  metaName: string;
  metaLanguage: string;
  metaTemplateId: string;
  rejectionReason: string;
  quality: WaTemplateQuality;
  qualityUpdatedAt: string;
  syncedAt: string;
  headerFormat: WaHeaderFormat;
  headerText: string;
  body: string;
  footer: string;
  buttons: WaTemplateButton[];
  /** Named placeholders e.g. guardianName, childName */
  variables: string[];
  mediaUrl: string;
  /** Uploaded header media filename (PDF/JPG etc.) */
  mediaFileName: string;
  carousel: WaCarouselCard[];
  /**
   * Send this ONE template from a specific number, overriding the module's.
   *
   * Empty is the normal case and is not a gap: the module's number is the
   * setting people actually maintain, and per-template routing exists for the
   * exception, not the rule. Sixty-seven templates each needing a number set
   * is sixty-seven chances to forget one.
   */
  senderNumberId?: string;
  /** Free-text fallback for 24h session / wa.me */
  localFallbackBody: string;
  paused: boolean;
  updatedAt: string;
  createdAt: string;
};

/**
 * A WhatsApp number the school can send FROM.
 *
 * Templates are registered against the WABA, not against a number, so every
 * number here can send every approved template — which number sends what is
 * the school's routing decision, not Meta's restriction.
 */
export type WaSenderNumber = {
  id: string;
  /** What staff call it: "Office", "Fees counter", "Admissions". */
  label: string;
  /** Meta's phone_number_id — the thing the Graph API is actually posted to. */
  phoneNumberId: string;
  /** Shown to staff so they can tell which number a family will see. */
  displayNumber: string;
  /** Used by any module with no sender of its own. Exactly one is true. */
  isDefault: boolean;
  paused: boolean;
};

export type WaTemplatesState = {
  version: 1;
  templates: WaTemplate[];
  lastMetaSyncAt: string;
  audit: { at: string; by: string; action: string; detail: string }[];
  /** Numbers the school can send from. Empty = the single env-configured one. */
  senders: WaSenderNumber[];
  /** Which number each module sends from. A module absent here uses the default. */
  moduleSenders: Partial<Record<WaTemplateModule, string>>;
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function collectTemplateVariables(parts: {
  headerText?: string;
  body?: string;
  footer?: string;
  carousel?: WaCarouselCard[];
}): string[] {
  const carouselText = (parts.carousel || []).map((c) => c.body).join("\n");
  return extractVariables(
    `${parts.headerText || ""}\n${parts.body || ""}\n${parts.footer || ""}\n${carouselText}`,
  );
}

export type WaTemplateVariableDef = {
  key: string;
  label: string;
  group: string;
  sample: string;
  hint?: string;
};

/** Named placeholders for WhatsApp template body / automation payloads. */
export const WA_TEMPLATE_VARIABLES: WaTemplateVariableDef[] = [
  { key: "guardianName", label: "Guardian / parent name", group: "Parent", sample: "Priya Sharma" },
  { key: "childName", label: "Child name", group: "Student", sample: "Aarav Sharma" },
  { key: "studentName", label: "Student name", group: "Student", sample: "Aarav Sharma" },
  { key: "classLabel", label: "Class & section", group: "Student", sample: "Class 5 A" },
  { key: "className", label: "Class name", group: "Student", sample: "Class 5" },
  { key: "schoolName", label: "School name", group: "School", sample: "BHB International School" },
  { key: "feeDue", label: "Fee amount due", group: "Fees", sample: "₹12,500" },
  { key: "amount", label: "Amount", group: "Fees", sample: "₹5,000" },
  { key: "dueDate", label: "Due date", group: "Fees", sample: "15 Aug 2026" },
  { key: "payLink", label: "Payment link", group: "Fees", sample: "https://school.example/pay" },
  { key: "payToken", label: "Pay-now button token (link id + code)", group: "Fees", sample: "pl_8f3k2x9a.PL-7K2M", hint: "Fills the Pay now button's URL; the sender supplies it from the payment link." },
  { key: "receiptNo", label: "Receipt number", group: "Fees", sample: "RCP-1042" },
  { key: "paidOn", label: "Paid on date", group: "Fees", sample: "4 Aug 2026" },
  { key: "stage", label: "Reminder stage", group: "Fees", sample: "2" },
  { key: "registerLink", label: "Registration link", group: "Admissions", sample: "https://school.example/register" },
  { key: "homeworkTitle", label: "Homework title", group: "Academic", sample: "Math worksheet ch.4" },
  { key: "subject", label: "Subject", group: "Academic", sample: "Mathematics" },
  { key: "examName", label: "Exam name", group: "Academic", sample: "Term 1" },
  { key: "ptmDate", label: "PTM date", group: "Academic", sample: "12 Aug 2026" },
  { key: "ptmTime", label: "PTM time", group: "Academic", sample: "10:00 AM" },
  { key: "ptmLink", label: "PTM booking link", group: "Academic", sample: "https://school.example/ptm" },
  { key: "leaveStatus", label: "Leave status", group: "Leave", sample: "Approved" },
  { key: "leaveFrom", label: "Leave from", group: "Leave", sample: "5 Aug 2026" },
  { key: "leaveTo", label: "Leave to", group: "Leave", sample: "7 Aug 2026" },
  { key: "staffName", label: "Staff name", group: "Staff", sample: "Rajesh Kumar" },
  { key: "noticeTitle", label: "Notice title", group: "Comms", sample: "Holiday announcement" },
  { key: "noticeBody", label: "Notice body", group: "Comms", sample: "School closed on Friday." },
  { key: "messageText", label: "Parent's message", group: "Comms", sample: "Amay could not finish the worksheet, please guide." },
  { key: "holidayTitle", label: "Holiday name", group: "Holidays", sample: "Diwali break" },
  { key: "holidayFrom", label: "Holiday from", group: "Holidays", sample: "Mon 19 Oct" },
  { key: "holidayTo", label: "Holiday to", group: "Holidays", sample: "Sat 24 Oct" },
  { key: "reopenDate", label: "School reopens on", group: "Holidays", sample: "Mon 26 Oct" },
  { key: "holidayReason", label: "Closure reason", group: "Holidays", sample: "the heat wave" },
  { key: "orderedBy", label: "Closure ordered by", group: "Holidays", sample: "the District Magistrate, Varanasi" },
  { key: "holidayNote", label: "Holiday note", group: "Holidays", sample: "Homework for these days is in the parent app." },
  { key: "docTitle", label: "Document title", group: "Vault", sample: "Fire NOC" },
  { key: "expiryDate", label: "Expiry date", group: "Vault", sample: "31 Dec 2026" },
  { key: "orderNo", label: "Store order no.", group: "Store", sample: "STR-882" },
  { key: "orderStatus", label: "Store order status", group: "Store", sample: "Ready" },
  { key: "routeName", label: "Transport route", group: "Transport", sample: "Route 3 — City" },
  { key: "busNo", label: "Bus number", group: "Transport", sample: "MAGIC 1" },
  { key: "stopName", label: "Bus stop", group: "Transport", sample: "Ayar Mod" },
  { key: "expectedTime", label: "Expected time at stop", group: "Transport", sample: "07:10" },
  { key: "minutesLate", label: "Minutes late", group: "Transport", sample: "20" },
  { key: "effectiveFrom", label: "Change effective from", group: "Transport", sample: "1 Sep 2026" },
  { key: "actionTaken", label: "What the school is doing", group: "Transport", sample: "A replacement bus is on the way." },
  { key: "certType", label: "Certificate type", group: "Certificates", sample: "Bonafide" },
  { key: "date", label: "Date", group: "General", sample: "4 Aug 2026" },
  { key: "time", label: "Time", group: "General", sample: "10:30 AM" },
  { key: "otp", label: "OTP code", group: "General", sample: "482910" },
];

export function waTemplateVariableGroups(): string[] {
  return [...new Set(WA_TEMPLATE_VARIABLES.map((v) => v.group))];
}

export function insertWaVariableToken(text: string, key: string): string {
  const token = `{{${key}}}`;
  const trimmed = text.trimEnd();
  if (!trimmed) return token;
  if (trimmed.endsWith(" ")) return `${trimmed}${token}`;
  return `${trimmed} ${token}`;
}

export const WA_TEMPLATE_MEDIA_MAX_BYTES = 1_200_000;

export async function readWaTemplateMediaFile(
  file: File,
  kind: "image" | "video" | "document",
): Promise<
  | { ok: true; dataUrl: string; fileName: string }
  | { ok: false; error: string }
> {
  if (file.size > WA_TEMPLATE_MEDIA_MAX_BYTES) {
    return {
      ok: false,
      error: "File too large — max 1.2 MB for desk storage. Use a CDN URL for production.",
    };
  }
  if (kind === "image" && !/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    return { ok: false, error: "Use JPG, PNG, or WebP for image headers." };
  }
  if (kind === "video" && !/^video\/mp4$/i.test(file.type)) {
    return { ok: false, error: "Use MP4 for video headers." };
  }
  if (kind === "document" && file.type !== "application/pdf") {
    return { ok: false, error: "Use PDF for document headers." };
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl.startsWith("data:")) {
        resolve({ ok: false, error: "Could not read file" });
        return;
      }
      resolve({ ok: true, dataUrl, fileName: file.name });
    };
    reader.onerror = () => resolve({ ok: false, error: "Upload failed" });
    reader.readAsDataURL(file);
  });
}

function extractVariables(body: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    found.add(m[1]!);
  }
  return [...found];
}

type SeedDef = {
  familyKey: string;
  nameEn: string;
  nameHi: string;
  module: WaTemplateModule;
  category: WaTemplateCategory;
  metaName: string;
  headerFormat?: WaHeaderFormat;
  headerTextEn?: string;
  headerTextHi?: string;
  bodyEn: string;
  bodyHi: string;
  footerEn?: string;
  footerHi?: string;
  buttons?: WaTemplateButton[];
  /** Hindi labels for the same buttons, same order. Falls back to `buttons`. */
  buttonsHi?: WaTemplateButton[];
  mediaUrl?: string;
  carousel?: Omit<WaCarouselCard, "id">[];
};

/**
 * Where a static button should take a parent. The parent app is the one
 * destination every template can safely point at without a per-family
 * variable — Meta only allows a variable at the END of a button URL, and a
 * full pay link cannot be expressed that way.
 */
export const WA_PARENT_APP_URL = "https://bhbinternational.school/parent";

const OPEN_APP_EN: WaTemplateButton = { type: "URL", text: "Open parent app", url: WA_PARENT_APP_URL };
const OPEN_APP_HI: WaTemplateButton = { type: "URL", text: "पैरेंट ऐप खोलें", url: WA_PARENT_APP_URL };
const CALL_ME_EN: WaTemplateButton = { type: "QUICK_REPLY", text: "Call me back" };
const CALL_ME_HI: WaTemplateButton = { type: "QUICK_REPLY", text: "मुझे फ़ोन करें" };
const PAID_EN: WaTemplateButton = { type: "QUICK_REPLY", text: "Already paid" };
const PAID_HI: WaTemplateButton = { type: "QUICK_REPLY", text: "भुगतान हो गया" };
/**
 * "Pay now" that opens THIS family's payment link. Meta allows one variable
 * in a button URL, at the end; /pay/go unpacks link id + code from it and
 * lands on the school's pay page, which hands off to Cashfree.
 */
export const WA_PAY_NOW_URL = "https://bhbinternational.school/pay/go/{{payToken}}";
const PAY_NOW_EN: WaTemplateButton = { type: "URL", text: "Pay now", url: WA_PAY_NOW_URL };
const PAY_NOW_HI: WaTemplateButton = { type: "URL", text: "अभी भुगतान करें", url: WA_PAY_NOW_URL };
/** "Pay now" for reminders that carry no link of their own: the parent portal's fee page. */
const PAY_PORTAL_EN: WaTemplateButton = { type: "URL", text: "Pay now", url: WA_PARENT_APP_URL };
const PAY_PORTAL_HI: WaTemplateButton = { type: "URL", text: "अभी भुगतान करें", url: WA_PARENT_APP_URL };

const SEED_DEFS: SeedDef[] = [
  // Every template reads the same way on a parent's phone: a warm greeting,
  // the facts on their own lines with a small icon each, one clear thing to
  // do, and a fixed sign-off — Meta refuses a body that starts or ends on a
  // variable, and a parent skims a message, they do not read it.
  //
  // ── Transport ────────────────────────────────────────────────
  // Nothing sends until Meta approves the name: the fleet-edge alert path
  // has already proved that free-form fails outside the 24h window, 223
  // times in a row. The ETA wording says "expected" and names it as a
  // schedule on purpose — there is no live position behind it.
  {
    familyKey: "transport_eta",
    nameEn: "Bus expected time",
    nameHi: "बस का अनुमानित समय",
    module: "transport",
    category: "UTILITY",
    metaName: "bhb_transport_eta",
    headerFormat: "TEXT",
    headerTextEn: "Bus update",
    headerTextHi: "बस अपडेट",
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\n🚌 Bus *{{busNo}}* is expected at *{{stopName}}* at about *{{expectedTime}}* for {{childName}}.\n\nThis is the scheduled time, not the bus's live position. Please be at the stop a few minutes early.\n\nHave a good day! 🌼",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n🚌 {{childName}} के लिए बस *{{busNo}}* *{{stopName}}* पर लगभग *{{expectedTime}}* बजे पहुँचने की उम्मीद है।\n\nयह निर्धारित समय है, बस की लाइव लोकेशन नहीं। कृपया कुछ मिनट पहले स्टॉप पर पहुँचें।\n\nआपका दिन शुभ हो! 🌼",
    footerEn: "Transport desk · Reply to this message for help",
    footerHi: "परिवहन कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "transport_delay",
    nameEn: "Bus running late",
    nameHi: "बस देरी से",
    module: "transport",
    category: "UTILITY",
    metaName: "bhb_transport_delay",
    headerFormat: "TEXT",
    headerTextEn: "Bus running late",
    headerTextHi: "बस देरी से",
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\n⏰ Bus *{{busNo}}* is running about *{{minutesLate}} minutes late* for {{stopName}}.\n\n{{childName}} will be picked up as soon as it arrives — please keep them ready at the stop.\n\nSorry for the wait, and thank you for your patience. 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n⏰ बस *{{busNo}}* {{stopName}} के लिए लगभग *{{minutesLate}} मिनट देरी* से चल रही है।\n\n{{childName}} को बस पहुँचते ही ले लिया जाएगा — कृपया उन्हें स्टॉप पर तैयार रखें।\n\nअसुविधा के लिए खेद है, आपके धैर्य के लिए धन्यवाद। 🙏",
    footerEn: "Transport desk · Reply to this message for help",
    footerHi: "परिवहन कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "transport_breakdown",
    nameEn: "Bus breakdown",
    nameHi: "बस खराब",
    module: "transport",
    category: "UTILITY",
    metaName: "bhb_transport_breakdown",
    headerFormat: "TEXT",
    headerTextEn: "Bus update: important",
    headerTextHi: "बस सूचना: महत्वपूर्ण",
    buttons: [CALL_ME_EN],
    buttonsHi: [CALL_ME_HI],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\n⚠️ Bus *{{busNo}}* has broken down on the way.\n\n✅ {{childName}} is *safe* with the bus attendant.\n\n🔧 What we are doing: {{actionTaken}}\n\nWe will message you again the moment there is an update. Thank you for your patience. 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n⚠️ बस *{{busNo}}* रास्ते में खराब हो गई है।\n\n✅ {{childName}} बस परिचारक के साथ *सुरक्षित* हैं।\n\n🔧 हम क्या कर रहे हैं: {{actionTaken}}\n\nकोई भी नई जानकारी मिलते ही हम फिर संदेश भेजेंगे। आपके धैर्य के लिए धन्यवाद। 🙏",
    footerEn: "Transport desk · Reply to this message for help",
    footerHi: "परिवहन कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "transport_route_change",
    nameEn: "Bus or stop changed",
    nameHi: "बस या स्टॉप में बदलाव",
    module: "transport",
    category: "UTILITY",
    metaName: "bhb_transport_route_change",
    headerFormat: "TEXT",
    headerTextEn: "Transport change",
    headerTextHi: "परिवहन में बदलाव",
    buttons: [{ type: "QUICK_REPLY", text: "Need a change" }],
    buttonsHi: [{ type: "QUICK_REPLY", text: "बदलाव चाहिए" }],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\nThere is a change in {{childName}}'s school transport:\n\n📅 From: *{{effectiveFrom}}*\n📍 Stop: *{{stopName}}*\n🚌 Bus: *{{busNo}}*\n\nIf this does not suit your family, please reply to this message or call the school office and we will sort it out.\n\nThank you! 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n{{childName}} के स्कूल परिवहन में बदलाव है:\n\n📅 कब से: *{{effectiveFrom}}*\n📍 स्टॉप: *{{stopName}}*\n🚌 बस: *{{busNo}}*\n\nयदि यह आपके परिवार के लिए उपयुक्त न हो, तो कृपया इसी संदेश का उत्तर दें या विद्यालय कार्यालय में फ़ोन करें — हम व्यवस्था कर देंगे।\n\nधन्यवाद! 🙏",
    footerEn: "Transport desk · Reply to this message for help",
    footerHi: "परिवहन कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "transport_not_boarded",
    nameEn: "Child did not board",
    nameHi: "बच्चा बस में नहीं चढ़ा",
    module: "transport",
    category: "UTILITY",
    metaName: "bhb_transport_not_boarded",
    headerFormat: "TEXT",
    headerTextEn: "Safety check",
    headerTextHi: "सुरक्षा जांच",
    buttons: [{ type: "QUICK_REPLY", text: "Travelling separately" }, CALL_ME_EN],
    buttonsHi: [{ type: "QUICK_REPLY", text: "अलग से आ रहे हैं" }, CALL_ME_HI],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\n❗ {{childName}} did *not board* bus *{{busNo}}* at {{stopName}} at *{{time}}* today.\n\nIf they are travelling separately today, please reply *OK* so we know all is well. If not, please call the school office right away.\n\nWe just want to be sure your child is safe. 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n❗ {{childName}} आज *{{time}}* बजे {{stopName}} पर बस *{{busNo}}* में *नहीं चढ़े*।\n\nयदि वे आज अलग से आ रहे हैं, तो कृपया *OK* लिखकर उत्तर दें ताकि हमें पता रहे कि सब ठीक है। यदि नहीं, तो कृपया तुरंत विद्यालय कार्यालय में फ़ोन करें।\n\nहम बस यह सुनिश्चित करना चाहते हैं कि आपका बच्चा सुरक्षित है। 🙏",
    footerEn: "Transport desk · Reply to this message for help",
    footerHi: "परिवहन कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },

  // ── Admissions ───────────────────────────────────────────────
  {
    familyKey: "admissions_registration_invite",
    nameEn: "Registration invite",
    nameHi: "पंजीकरण आमंत्रण",
    module: "admissions",
    category: "UTILITY",
    metaName: "bhb_registration_invite",
    headerFormat: "TEXT",
    headerTextEn: "Registration",
    headerTextHi: "पंजीकरण",
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\nThank you for your interest in *{{schoolName}}* for {{childName}}. 🎒\n\nThe next step is a short online registration — it takes about 5 minutes:\n\n🔗 {{registerLink}}\n\nOnce done, our admissions team will call you to fix a campus visit. We look forward to welcoming your family! 🌼",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n{{childName}} के लिए *{{schoolName}}* में रुचि दिखाने के लिए धन्यवाद। 🎒\n\nअगला कदम एक छोटा-सा ऑनलाइन पंजीकरण है — इसमें लगभग 5 मिनट लगते हैं:\n\n🔗 {{registerLink}}\n\nपंजीकरण के बाद हमारी प्रवेश टीम आपको फ़ोन करके कैंपस विज़िट तय करेगी। आपके परिवार का स्वागत करने की प्रतीक्षा है! 🌼",
    footerEn: "Admissions desk · Reply to this message for help",
    footerHi: "प्रवेश कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "admissions_fee_reminder",
    nameEn: "Registration fee reminder",
    nameHi: "पंजीकरण शुल्क अनुस्मारक",
    module: "admissions",
    category: "UTILITY",
    metaName: "bhb_registration_fee_reminder",
    headerFormat: "TEXT",
    headerTextEn: "Registration fee",
    headerTextHi: "पंजीकरण शुल्क",
    buttons: [PAID_EN],
    buttonsHi: [PAID_HI],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\nA gentle reminder — the registration fee for {{childName}} is pending:\n\n💰 Amount: *{{feeDue}}*\n\nPay securely in a minute (UPI, card or net banking):\n🔗 {{payLink}}\n\nYour seat is confirmed as soon as the payment goes through. Thank you! 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\nएक विनम्र स्मरण — {{childName}} का पंजीकरण शुल्क बाकी है:\n\n💰 राशि: *{{feeDue}}*\n\nएक मिनट में सुरक्षित भुगतान करें (UPI, कार्ड या नेट बैंकिंग):\n🔗 {{payLink}}\n\nभुगतान होते ही सीट पक्की हो जाएगी। धन्यवाद! 🙏",
    footerEn: "Admissions desk · Reply to this message for help",
    footerHi: "प्रवेश कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "admissions_open_day",
    nameEn: "Open day / campus visit",
    nameHi: "ओपन डे / कैंपस विज़िट",
    module: "admissions",
    category: "MARKETING",
    metaName: "bhb_open_day_invite",
    headerFormat: "IMAGE",
    mediaUrl: "",
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\nYou are warmly invited to visit *{{schoolName}}* with {{childName}}! 🏫\n\nWalk through our classrooms, meet the teachers, and get a one-to-one counselling session on the right class and the way we teach.\n\nBook your visit here:\n🔗 {{registerLink}}\n\nWe would love to show you around. 🌼",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n{{childName}} के साथ *{{schoolName}}* देखने आने का हार्दिक निमंत्रण! 🏫\n\nहमारी कक्षाएँ देखें, शिक्षकों से मिलें, और सही कक्षा व हमारी पढ़ाने की पद्धति पर व्यक्तिगत काउंसलिंग पाएँ।\n\nअपनी विज़िट यहाँ बुक करें:\n🔗 {{registerLink}}\n\nआपको कैंपस दिखाने में हमें खुशी होगी। 🌼",
    footerEn: "Admissions desk · Reply STOP to opt out",
    footerHi: "प्रवेश कार्यालय · संदेश बंद करने के लिए STOP लिखें",
  },
  {
    familyKey: "admissions_followup",
    nameEn: "Admission follow-up",
    nameHi: "प्रवेश फॉलो-अप",
    module: "admissions",
    category: "UTILITY",
    metaName: "bhb_admission_followup",
    headerFormat: "TEXT",
    headerTextEn: "Admission enquiry",
    headerTextHi: "प्रवेश पूछताछ",
    buttons: [{ type: "QUICK_REPLY", text: "Yes, call me" }, { type: "QUICK_REPLY", text: "Book campus visit" }],
    buttonsHi: [{ type: "QUICK_REPLY", text: "हाँ, फ़ोन करें" }, { type: "QUICK_REPLY", text: "कैंपस विज़िट बुक करें" }],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\nJust checking in on {{childName}}'s admission enquiry at *{{schoolName}}*. 🎒\n\nIs there anything we can help with — the class, fees, transport, or a campus visit?\n\n👉 Reply *YES* and our admissions team will call you back, or reply with your question here.\n\nWe are happy to help. 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n*{{schoolName}}* में {{childName}} की प्रवेश पूछताछ के बारे में हाल जानना चाहते हैं। 🎒\n\nक्या किसी बात में मदद चाहिए — कक्षा, शुल्क, परिवहन या कैंपस विज़िट?\n\n👉 *YES* लिखें और हमारी प्रवेश टीम आपको फ़ोन करेगी, या अपना प्रश्न यहीं लिख भेजें।\n\nहमें मदद करके खुशी होगी। 🙏",
    footerEn: "Admissions desk · Reply to this message for help",
    footerHi: "प्रवेश कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },

  // ── Fees ─────────────────────────────────────────────────────
  {
    familyKey: "fees_soft_reminder",
    nameEn: "Fee soft reminder",
    nameHi: "शुल्क सौम्य अनुस्मारक",
    module: "fees",
    category: "UTILITY",
    metaName: "bhb_fee_soft_reminder",
    headerFormat: "TEXT",
    headerTextEn: "Fee reminder",
    headerTextHi: "शुल्क स्मरण",
    buttons: [PAY_PORTAL_EN, PAID_EN],
    buttonsHi: [PAY_PORTAL_HI, PAID_HI],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\nA friendly reminder that {{childName}}'s school fee ({{classLabel}}) is due soon:\n\n💰 Amount: *{{feeDue}}*\n\nPay in a minute from your phone — UPI, card or net banking:\n🔗 {{payLink}}\n\nYour receipt arrives on WhatsApp the moment the payment goes through. Thank you! 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\nएक विनम्र स्मरण — {{childName}} ({{classLabel}}) का विद्यालय शुल्क शीघ्र देय है:\n\n💰 राशि: *{{feeDue}}*\n\nअपने फ़ोन से एक मिनट में भुगतान करें — UPI, कार्ड या नेट बैंकिंग:\n🔗 {{payLink}}\n\nभुगतान होते ही रसीद व्हाट्सऐप पर आ जाएगी। धन्यवाद! 🙏",
    footerEn: "Fee counter · Reply to this message for help",
    footerHi: "शुल्क काउंटर · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "fees_stage_reminder",
    nameEn: "Fee overdue stage reminder",
    nameHi: "बकाया शुल्क चरण अनुस्मारक",
    module: "fees",
    category: "UTILITY",
    metaName: "bhb_fee_stage_reminder",
    headerFormat: "TEXT",
    headerTextEn: "Fee overdue",
    headerTextHi: "शुल्क बकाया",
    buttons: [PAY_PORTAL_EN, PAID_EN, { type: "QUICK_REPLY", text: "Need more time" }],
    buttonsHi: [PAY_PORTAL_HI, PAID_HI, { type: "QUICK_REPLY", text: "थोड़ा समय चाहिए" }],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\n{{childName}}'s school fee is *overdue* (reminder {{stage}}):\n\n💰 Amount pending: *{{feeDue}}*\n\nPlease clear it at your earliest — it takes a minute:\n🔗 {{payLink}}\n\nIf you have already paid or need a little more time, just reply to this message and the fee counter will help. Thank you! 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n{{childName}} का विद्यालय शुल्क *बकाया* है (स्मरण {{stage}}):\n\n💰 बकाया राशि: *{{feeDue}}*\n\nकृपया जल्द से जल्द भुगतान करें — इसमें एक मिनट लगता है:\n🔗 {{payLink}}\n\nयदि आपने भुगतान कर दिया है या थोड़ा समय चाहिए, तो इसी संदेश का उत्तर दें — शुल्क काउंटर आपकी मदद करेगा। धन्यवाद! 🙏",
    footerEn: "Fee counter · Reply to this message for help",
    footerHi: "शुल्क काउंटर · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "fees_pay_link",
    nameEn: "Fee pay link",
    nameHi: "शुल्क भुगतान लिंक",
    module: "fees",
    category: "UTILITY",
    metaName: "bhb_fee_pay_link",
    bodyEn:
      "Namaste 🙏 Your fee payment link from *{{schoolName}}* for {{childName}} is ready:\n\n💰 Amount: *{{feeDue}}*\n\nTap *Pay now* below to pay securely with UPI, card or net banking — the receipt comes to you on WhatsApp right after.\n\nIf the button does not open, use this link:\n🔗 {{payLink}}\n\nThank you! 🙏",
    bodyHi:
      "नमस्ते 🙏 *{{schoolName}}* की ओर से {{childName}} के शुल्क भुगतान का लिंक तैयार है:\n\n💰 राशि: *{{feeDue}}*\n\nUPI, कार्ड या नेट बैंकिंग से सुरक्षित भुगतान के लिए नीचे *अभी भुगतान करें* दबाएँ — रसीद तुरंत व्हाट्सऐप पर मिलेगी।\n\nयदि बटन न खुले, तो यह लिंक इस्तेमाल करें:\n🔗 {{payLink}}\n\nधन्यवाद! 🙏",
    buttons: [PAY_NOW_EN],
    buttonsHi: [PAY_NOW_HI],
    footerEn: "Fee counter · Reply to this message for help",
    footerHi: "शुल्क काउंटर · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "fees_receipt",
    nameEn: "Fee receipt share",
    nameHi: "शुल्क रसीद",
    module: "fees",
    category: "UTILITY",
    metaName: "bhb_fee_receipt",
    bodyEn:
      "Namaste 🙏 Thank you for your payment!\n\n✅ Receipt no: *{{receiptNo}}*\n👧 Student: {{childName}}\n💰 Paid: *{{feeDue}}*\n📅 On: {{paidOn}}\n\nYour receipt PDF is attached above and is also saved in the parent app under Receipts.\n\nWith thanks, *{{schoolName}}* 🌼",
    bodyHi:
      "नमस्ते 🙏 भुगतान के लिए धन्यवाद!\n\n✅ रसीद संख्या: *{{receiptNo}}*\n👧 छात्र: {{childName}}\n💰 भुगतान: *{{feeDue}}*\n📅 दिनांक: {{paidOn}}\n\nरसीद की PDF ऊपर संलग्न है और पैरेंट ऐप में \"Receipts\" में भी सुरक्षित है।\n\nसधन्यवाद, *{{schoolName}}* 🌼",
    footerEn: "Fee counter · Keep this for your records",
    footerHi: "शुल्क काउंटर · इसे अपने रिकॉर्ड के लिए रखें",
  },
  {
    familyKey: "fees_marketing_carousel",
    nameEn: "Fee offer carousel",
    nameHi: "शुल्क ऑफर कैरोसेल",
    module: "fees",
    category: "MARKETING",
    metaName: "bhb_fee_offer_carousel",
    headerFormat: "NONE",
    bodyEn:
      "Namaste 🙏 Fee options for the new session at *{{schoolName}}* — swipe the cards below to see what suits your family best. 🎒",
    bodyHi:
      "नमस्ते 🙏 *{{schoolName}}* में नए सत्र के शुल्क विकल्प — नीचे कार्ड स्वाइप करके देखें कि आपके परिवार के लिए क्या सबसे उपयुक्त है। 🎒",
    carousel: [
      {
        headerFormat: "IMAGE",
        body: "🌟 Early-bird concession — pay the annual fee before the session starts and save.",
        buttons: [{ type: "URL", text: "Pay now", url: "{{payLink}}" }],
      },
      {
        headerFormat: "IMAGE",
        body: "📆 Easy instalments for {{classLabel}} — spread the fee across the year, no extra charge.",
        buttons: [{ type: "QUICK_REPLY", text: "Know more" }],
      },
    ],
    footerEn: "Fee counter · Reply STOP to opt out",
    footerHi: "शुल्क काउंटर · संदेश बंद करने के लिए STOP लिखें",
  },

  // ── Daily school life ────────────────────────────────────────
  {
    familyKey: "attendance_absent",
    nameEn: "Student absent alert",
    nameHi: "छात्र अनुपस्थिति सूचना",
    module: "attendance",
    category: "UTILITY",
    metaName: "bhb_attendance_absent",
    headerFormat: "TEXT",
    headerTextEn: "Attendance today",
    headerTextHi: "आज की उपस्थिति",
    buttons: [{ type: "QUICK_REPLY", text: "Child is unwell" }, { type: "QUICK_REPLY", text: "This is a mistake" }],
    buttonsHi: [{ type: "QUICK_REPLY", text: "बच्चा अस्वस्थ है" }, { type: "QUICK_REPLY", text: "यह गलती है" }],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\n📋 {{childName}} ({{classLabel}}) has been marked *absent* today, {{date}}.\n\nIf this is a mistake, or if your child is unwell, please reply to this message so the class teacher knows.\n\nWishing {{childName}} a quick return to class! 🌼",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n📋 {{childName}} ({{classLabel}}) आज, {{date}} को *अनुपस्थित* अंकित किए गए हैं।\n\nयदि यह गलती है, या आपका बच्चा अस्वस्थ है, तो कृपया इसी संदेश का उत्तर दें ताकि कक्षा शिक्षक को पता रहे।\n\n{{childName}} जल्द कक्षा में लौटें, यही कामना है! 🌼",
    footerEn: "Class teacher · Reply to this message",
    footerHi: "कक्षा शिक्षक · इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "homework_published",
    nameEn: "Homework published",
    nameHi: "गृहकार्य प्रकाशित",
    module: "homework",
    category: "UTILITY",
    metaName: "bhb_homework_published",
    headerFormat: "TEXT",
    headerTextEn: "New homework",
    headerTextHi: "नया गृहकार्य",
    buttons: [OPEN_APP_EN],
    buttonsHi: [OPEN_APP_HI],
    bodyEn:
      "Namaste 🙏 New homework for *{{classLabel}}* is up:\n\n📘 Subject: *{{subject}}*\n📝 Work: {{homeworkTitle}}\n📅 Due: *{{dueDate}}*\n\nOpen the parent app for the full details — and tap *Ask tutor* there if your child needs a hand with it. 🎓\n\n— {{schoolName}}, with thanks 🙏",
    bodyHi:
      "नमस्ते 🙏 *{{classLabel}}* का नया गृहकार्य आ गया है:\n\n📘 विषय: *{{subject}}*\n📝 कार्य: {{homeworkTitle}}\n📅 अंतिम तिथि: *{{dueDate}}*\n\nपूरा विवरण पैरेंट ऐप में देखें — और यदि बच्चे को मदद चाहिए तो वहीं *Ask tutor* दबाएँ। 🎓\n\n— {{schoolName}}, सधन्यवाद 🙏",
    footerEn: "Class teacher · Open the parent app for details",
    footerHi: "कक्षा शिक्षक · विवरण पैरेंट ऐप में देखें",
  },
  {
    familyKey: "exams_datesheet",
    nameEn: "Exam datesheet",
    nameHi: "परीक्षा डेटशीट",
    module: "exams",
    category: "UTILITY",
    metaName: "bhb_exam_datesheet",
    buttons: [OPEN_APP_EN],
    buttonsHi: [OPEN_APP_HI],
    headerFormat: "DOCUMENT",
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\n📅 The date sheet for *{{examName}}* is ready for {{childName}} — it is attached above as a PDF.\n\nPlease note the dates, and help your child start revision early. The AI tutor in the parent app has an *Exam preparation* mode for exactly this. 🎓\n\nAll the best to {{childName}}! 🌟",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n📅 {{childName}} के लिए *{{examName}}* की डेटशीट तैयार है — ऊपर PDF संलग्न है।\n\nकृपया तारीखें नोट करें और बच्चे को समय से दोहराई शुरू करने में मदद करें। पैरेंट ऐप के AI ट्यूटर में इसी के लिए *Exam preparation* मोड है। 🎓\n\n{{childName}} को शुभकामनाएँ! 🌟",
    footerEn: "Examination desk · Reply to this message for help",
    footerHi: "परीक्षा विभाग · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "exams_result",
    nameEn: "Exam result notify",
    nameHi: "परीक्षा परिणाम",
    module: "exams",
    category: "UTILITY",
    metaName: "bhb_exam_result",
    headerFormat: "TEXT",
    headerTextEn: "Results are out",
    headerTextHi: "परिणाम घोषित",
    buttons: [OPEN_APP_EN],
    buttonsHi: [OPEN_APP_HI],
    bodyEn:
      "Namaste 🙏 The results of *{{examName}}* are out for {{childName}}! 🎉\n\nOpen the parent app to see the marks, the report card and the teacher's remarks.\n\nWhatever the result, a word of encouragement from you goes a long way. 💛\n\n— {{schoolName}}, with best wishes 🙏",
    bodyHi:
      "नमस्ते 🙏 {{childName}} के *{{examName}}* के परिणाम आ गए हैं! 🎉\n\nअंक, रिपोर्ट कार्ड और शिक्षक की टिप्पणी पैरेंट ऐप में देखें।\n\nपरिणाम जो भी हो, आपके प्रोत्साहन के दो शब्द बहुत मायने रखते हैं। 💛\n\n— {{schoolName}}, शुभकामनाओं सहित 🙏",
    footerEn: "Examination desk · Open the parent app",
    footerHi: "परीक्षा विभाग · पैरेंट ऐप खोलें",
  },
  {
    familyKey: "ptm_invite",
    nameEn: "PTM invite",
    nameHi: "अभिभावक-शिक्षक बैठक",
    module: "ptm",
    category: "UTILITY",
    metaName: "bhb_ptm_invite",
    headerFormat: "TEXT",
    headerTextEn: "Parent-Teacher Meeting",
    headerTextHi: "अभिभावक-शिक्षक बैठक",
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\nYou are invited to the Parent–Teacher Meeting for {{childName}}:\n\n📅 Date: *{{ptmDate}}*\n⏰ Time: *{{ptmTime}}*\n\nPick a slot that suits you (it takes a moment):\n🔗 {{ptmLink}}\n\nA short conversation with the class teacher makes a real difference. We look forward to meeting you! 🌼",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n{{childName}} की अभिभावक–शिक्षक बैठक (PTM) में आपका स्वागत है:\n\n📅 दिनांक: *{{ptmDate}}*\n⏰ समय: *{{ptmTime}}*\n\nअपना सुविधाजनक स्लॉट चुनें (बस एक पल लगता है):\n🔗 {{ptmLink}}\n\nकक्षा शिक्षक से एक छोटी-सी बातचीत बहुत फ़र्क़ लाती है। आपसे मिलने की प्रतीक्षा है! 🌼",
    footerEn: "Class teacher · Reply to this message for help",
    footerHi: "कक्षा शिक्षक · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "leave_student_status",
    nameEn: "Student leave status",
    nameHi: "छात्र अवकाश स्थिति",
    module: "leave",
    category: "UTILITY",
    metaName: "bhb_student_leave_status",
    headerFormat: "TEXT",
    headerTextEn: "Leave request",
    headerTextHi: "अवकाश अनुरोध",
    bodyEn:
      "Namaste 🙏 An update on {{childName}}'s leave request:\n\n📋 Status: *{{leaveStatus}}*\n📅 Dates: {{leaveFrom}} to {{leaveTo}}\n\nIf you have a question about this, reply to this message and the class teacher will get back to you.\n\n— {{schoolName}}, with thanks 🙏",
    bodyHi:
      "नमस्ते 🙏 {{childName}} के अवकाश अनुरोध पर अपडेट:\n\n📋 स्थिति: *{{leaveStatus}}*\n📅 दिनांक: {{leaveFrom}} से {{leaveTo}}\n\nइस बारे में कोई प्रश्न हो तो इसी संदेश का उत्तर दें — कक्षा शिक्षक आपसे संपर्क करेंगे।\n\n— {{schoolName}}, सधन्यवाद 🙏",
    footerEn: "Class teacher · Reply to this message for help",
    footerHi: "कक्षा शिक्षक · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "leave_staff_status",
    nameEn: "Staff leave status",
    nameHi: "स्टाफ अवकाश स्थिति",
    module: "staff",
    category: "UTILITY",
    metaName: "bhb_staff_leave_status",
    headerFormat: "TEXT",
    headerTextEn: "Leave request",
    headerTextHi: "अवकाश अनुरोध",
    bodyEn:
      "Hello {{staffName}} 🙏\n\nAn update on your leave request:\n\n📋 Status: *{{leaveStatus}}*\n📅 Dates: {{leaveFrom}} to {{leaveTo}}\n\nFor anything about this, please reply to this message or speak to the office. Thank you!",
    bodyHi:
      "नमस्ते {{staffName}} जी 🙏\n\nआपके अवकाश अनुरोध पर अपडेट:\n\n📋 स्थिति: *{{leaveStatus}}*\n📅 दिनांक: {{leaveFrom}} से {{leaveTo}}\n\nइस बारे में कुछ भी पूछना हो तो इसी संदेश का उत्तर दें या कार्यालय से बात करें। धन्यवाद!",
    footerEn: "School office",
    footerHi: "विद्यालय कार्यालय",
  },
  {
    familyKey: "vault_expiry",
    nameEn: "Document vault expiry",
    nameHi: "दस्तावेज़ समाप्ति",
    module: "vault",
    category: "UTILITY",
    metaName: "bhb_vault_expiry",
    headerFormat: "TEXT",
    headerTextEn: "Document renewal",
    headerTextHi: "दस्तावेज़ नवीनीकरण",
    bodyEn:
      "Namaste 🙏 A reminder from *{{schoolName}}*:\n\n📄 Document: *{{docTitle}}*\n⏳ Expires on: *{{expiryDate}}*\n\nPlease renew it before that date and share the new copy with the school office, so the records stay complete. Thank you! 🙏",
    bodyHi:
      "नमस्ते 🙏 *{{schoolName}}* की ओर से एक स्मरण:\n\n📄 दस्तावेज़: *{{docTitle}}*\n⏳ वैधता समाप्ति: *{{expiryDate}}*\n\nकृपया इस तिथि से पहले इसका नवीनीकरण कराएँ और नई प्रति विद्यालय कार्यालय को दें, ताकि रिकॉर्ड पूरा रहे। धन्यवाद! 🙏",
    footerEn: "School office · Reply to this message for help",
    footerHi: "विद्यालय कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "comms_notice",
    nameEn: "School notice broadcast",
    nameHi: "विद्यालय सूचना",
    module: "comms",
    category: "UTILITY",
    metaName: "bhb_school_notice",
    headerFormat: "TEXT",
    headerTextEn: "School notice",
    headerTextHi: "विद्यालय सूचना",
    bodyEn:
      "📢 *Notice from {{schoolName}}*\n\n*{{noticeTitle}}*\n\n{{noticeBody}}\n\nPlease read carefully and reply to this message if you have a question. Thank you! 🙏",
    bodyHi:
      "📢 *{{schoolName}} की सूचना*\n\n*{{noticeTitle}}*\n\n{{noticeBody}}\n\nकृपया ध्यान से पढ़ें और कोई प्रश्न हो तो इसी संदेश का उत्तर दें। धन्यवाद! 🙏",
    footerEn: "School office",
    footerHi: "विद्यालय कार्यालय",
  },
  {
    familyKey: "store_order",
    nameEn: "Store order update",
    nameHi: "स्टोर ऑर्डर अपडेट",
    module: "store",
    category: "UTILITY",
    metaName: "bhb_store_order",
    headerFormat: "TEXT",
    headerTextEn: "School store",
    headerTextHi: "स्कूल स्टोर",
    bodyEn:
      "Namaste 🙏 An update on your school store order for {{childName}}:\n\n🧾 Order: *{{orderNo}}*\n📦 Status: *{{orderStatus}}*\n💰 Amount: {{feeDue}}\n\nBooks and uniforms can be collected from the school store on working days. Reply to this message for help.\n\n— {{schoolName}}, with thanks 🙏",
    bodyHi:
      "नमस्ते 🙏 {{childName}} के स्कूल स्टोर ऑर्डर पर अपडेट:\n\n🧾 ऑर्डर: *{{orderNo}}*\n📦 स्थिति: *{{orderStatus}}*\n💰 राशि: {{feeDue}}\n\nकिताबें और यूनिफ़ॉर्म कार्य-दिवसों में स्कूल स्टोर से ले सकते हैं। सहायता के लिए इसी संदेश का उत्तर दें।\n\n— {{schoolName}}, सधन्यवाद 🙏",
    footerEn: "School store",
    footerHi: "स्कूल स्टोर",
  },
  {
    familyKey: "transport_fee",
    nameEn: "Transport fee reminder",
    nameHi: "परिवहन शुल्क अनुस्मारक",
    module: "transport",
    category: "UTILITY",
    metaName: "bhb_transport_fee",
    headerFormat: "TEXT",
    headerTextEn: "Transport fee",
    headerTextHi: "परिवहन शुल्क",
    buttons: [PAY_PORTAL_EN, PAID_EN],
    buttonsHi: [PAY_PORTAL_HI, PAID_HI],
    bodyEn:
      "Namaste 🙏 A reminder that the transport fee for {{childName}} is due:\n\n🚌 Route: {{routeName}}\n💰 Amount: *{{feeDue}}*\n\nPay in a minute from your phone:\n🔗 {{payLink}}\n\nThe receipt comes to you on WhatsApp right after. Thank you! 🙏",
    bodyHi:
      "नमस्ते 🙏 स्मरण — {{childName}} का परिवहन शुल्क देय है:\n\n🚌 मार्ग: {{routeName}}\n💰 राशि: *{{feeDue}}*\n\nअपने फ़ोन से एक मिनट में भुगतान करें:\n🔗 {{payLink}}\n\nरसीद तुरंत व्हाट्सऐप पर मिलेगी। धन्यवाद! 🙏",
    footerEn: "Transport desk · Reply to this message for help",
    footerHi: "परिवहन कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "certificates_ready",
    nameEn: "Certificate ready",
    nameHi: "प्रमाणपत्र तैयार",
    module: "certificates",
    category: "UTILITY",
    metaName: "bhb_certificate_ready",
    headerFormat: "TEXT",
    headerTextEn: "Certificate ready",
    headerTextHi: "प्रमाणपत्र तैयार",
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\n📜 The *{{certType}}* for {{childName}} is ready and waiting for you at the school office.\n\nYou can collect it on any working day during office hours. Please carry a photo ID.\n\n— {{schoolName}}, with thanks 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n📜 {{childName}} का *{{certType}}* तैयार है और विद्यालय कार्यालय में आपकी प्रतीक्षा कर रहा है।\n\nकिसी भी कार्य-दिवस पर कार्यालय समय में इसे ले सकते हैं। कृपया एक फोटो पहचान-पत्र साथ लाएँ।\n\n— {{schoolName}}, सधन्यवाद 🙏",
    footerEn: "School office · Reply to this message for help",
    footerHi: "विद्यालय कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "rte_nudge",
    nameEn: "RTE / EWS nudge",
    nameHi: "RTE / EWS अनुस्मारक",
    module: "rte",
    category: "UTILITY",
    metaName: "bhb_rte_nudge",
    headerFormat: "TEXT",
    headerTextEn: "RTE / EWS admission",
    headerTextHi: "RTE / EWS प्रवेश",
    buttons: [{ type: "QUICK_REPLY", text: "Which documents?" }],
    buttonsHi: [{ type: "QUICK_REPLY", text: "कौन-से दस्तावेज़?" }],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\nTo complete {{childName}}'s RTE/EWS admission, a few documents are still needed:\n\n📅 Please submit them by *{{dueDate}}*\n\nBring them to the school office, or reply to this message if you are unsure which documents are required — we will guide you.\n\n— {{schoolName}}, with thanks 🙏",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n{{childName}} का RTE/EWS प्रवेश पूरा करने के लिए कुछ दस्तावेज़ अभी बाकी हैं:\n\n📅 कृपया *{{dueDate}}* तक जमा करें\n\nइन्हें विद्यालय कार्यालय में लाएँ, या कौन-से दस्तावेज़ चाहिए यह पूछने के लिए इसी संदेश का उत्तर दें — हम मार्गदर्शन करेंगे।\n\n— {{schoolName}}, सधन्यवाद 🙏",
    footerEn: "Admissions desk · Reply to this message for help",
    footerHi: "प्रवेश कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "field_survey_nudge",
    nameEn: "Field survey nudge",
    nameHi: "फील्ड सर्वे अनुस्मारक",
    module: "field",
    category: "MARKETING",
    metaName: "bhb_field_survey_nudge",
    headerFormat: "TEXT",
    headerTextEn: "Hello from the school",
    headerTextHi: "विद्यालय की ओर से नमस्ते",
    buttons: [CALL_ME_EN],
    buttonsHi: [CALL_ME_HI],
    bodyEn:
      "Namaste {{guardianName}} ji 🙏\n\nIt was lovely to meet you when our team visited about {{childName}}'s schooling. 🎒\n\nIf you would like to take the next step with *{{schoolName}}*, complete a quick enquiry here and our admissions desk will call you:\n🔗 {{registerLink}}\n\nNo pressure at all — we are here whenever you are ready. 🌼",
    bodyHi:
      "नमस्ते {{guardianName}} जी 🙏\n\n{{childName}} की पढ़ाई के बारे में जब हमारी टीम आई थी, आपसे मिलकर अच्छा लगा। 🎒\n\nयदि आप *{{schoolName}}* के साथ अगला कदम बढ़ाना चाहें, तो यहाँ एक छोटी-सी पूछताछ पूरी करें — हमारा प्रवेश कार्यालय आपको फ़ोन करेगा:\n🔗 {{registerLink}}\n\nकोई दबाव नहीं — जब भी आप तैयार हों, हम यहीं हैं। 🌼",
    footerEn: "Admissions desk · Reply STOP to opt out",
    footerHi: "प्रवेश कार्यालय · संदेश बंद करने के लिए STOP लिखें",
  },
  {
    familyKey: "auth_parent_login_otp",
    nameEn: "Parent login OTP",
    nameHi: "पालक लॉगिन OTP",
    module: "general",
    category: "AUTHENTICATION",
    metaName: "bhb_parent_login_otp",
    // Meta fixes the wording of AUTHENTICATION templates; only the code
    // slot is ours. Left as approved.
    bodyEn:
      "{{otp}} is your parent login verification code. Do not share this code with anyone. It expires in 10 minutes.",
    bodyHi:
      "{{otp}} आपका पालक लॉगिन सत्यापन कोड है। कृपया यह कोड किसी से साझा न करें। यह 10 मिनट में समाप्त हो जाएगा।",
  },
  {
    familyKey: "admissions_marketing_carousel",
    nameEn: "Admission highlights carousel",
    nameHi: "प्रवेश हाइलाइट कैरोसेल",
    module: "admissions",
    category: "MARKETING",
    metaName: "bhb_admission_carousel",
    bodyEn:
      "Namaste 🙏 Admissions are open at *{{schoolName}}*! Swipe the cards below to see why families choose us — and how to apply. 🎒",
    bodyHi:
      "नमस्ते 🙏 *{{schoolName}}* में प्रवेश खुले हैं! नीचे कार्ड स्वाइप करके देखें कि परिवार हमें क्यों चुनते हैं — और आवेदन कैसे करें। 🎒",
    carousel: [
      {
        headerFormat: "IMAGE",
        body: "📚 CBSE pattern, NCERT books, small classes — and an AI tutor at home for every child.",
        buttons: [{ type: "URL", text: "Apply", url: "{{registerLink}}" }],
      },
      {
        headerFormat: "IMAGE",
        body: "⚽ Sports, science lab, activity clubs and a library children actually use.",
        buttons: [{ type: "QUICK_REPLY", text: "Visit campus" }],
      },
      {
        headerFormat: "IMAGE",
        body: "🚌 Safe school buses with attendants, and a parent app that keeps you informed.",
        buttons: [{ type: "QUICK_REPLY", text: "Call desk" }],
      },
    ],
    footerEn: "Admissions desk · Reply STOP to opt out",
    footerHi: "प्रवेश कार्यालय · संदेश बंद करने के लिए STOP लिखें",
  },

  // ── Holidays ─────────────────────────────────────────────────
  // Two shapes. A planned holiday comes straight off the Masters calendar
  // (title and dates). An unplanned closure — the DM orders schools shut
  // for a heat wave, a cold wave, heavy rain, an election — carries the
  // reason and who ordered it, so a parent knows it is not the school's
  // whim and that the calendar holds otherwise. Both end on a fixed line
  // because Meta refuses a body that ends on a variable.
  {
    familyKey: "holiday_notice",
    nameEn: "Holiday notice (planned)",
    nameHi: "अवकाश सूचना (नियोजित)",
    module: "comms",
    category: "UTILITY",
    metaName: "bhb_holiday_notice",
    headerFormat: "TEXT",
    headerTextEn: "Holiday notice",
    headerTextHi: "अवकाश सूचना",
    bodyEn:
      "Namaste 🙏 A holiday notice from *{{schoolName}}*:\n\n🎉 *{{holidayTitle}}*\n📅 From: *{{holidayFrom}}*\n📅 To: *{{holidayTo}}*\n🏫 School reopens: *{{reopenDate}}*\n\n📝 {{holidayNote}}\n\nEnjoy the break with your family, and see you back at school! 🌼",
    bodyHi:
      "नमस्ते 🙏 *{{schoolName}}* की ओर से अवकाश सूचना:\n\n🎉 *{{holidayTitle}}*\n📅 से: *{{holidayFrom}}*\n📅 तक: *{{holidayTo}}*\n🏫 विद्यालय फिर खुलेगा: *{{reopenDate}}*\n\n📝 {{holidayNote}}\n\nपरिवार के साथ अवकाश का आनंद लें, फिर मिलते हैं विद्यालय में! 🌼",
    footerEn: "School office · Reply to this message for help",
    footerHi: "विद्यालय कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },
  {
    familyKey: "holiday_emergency",
    nameEn: "Unplanned closure (weather / administration)",
    nameHi: "अचानक अवकाश (मौसम / प्रशासन)",
    module: "comms",
    category: "UTILITY",
    metaName: "bhb_holiday_emergency",
    headerFormat: "TEXT",
    headerTextEn: "School closed",
    headerTextHi: "विद्यालय बंद",
    bodyEn:
      "Namaste 🙏 An important notice from *{{schoolName}}*:\n\n⚠️ School will remain *CLOSED* due to *{{holidayReason}}*, as ordered by {{orderedBy}}.\n\n📅 Closed from: *{{holidayFrom}}*\n📅 Closed till: *{{holidayTo}}*\n🏫 School reopens: *{{reopenDate}}*\n🚌 School buses will not run on these days.\n\n📝 {{holidayNote}}\n\nPlease keep your child safe at home. We will message you if the dates change. Thank you! 🙏",
    bodyHi:
      "नमस्ते 🙏 *{{schoolName}}* की ओर से महत्वपूर्ण सूचना:\n\n⚠️ *{{holidayReason}}* के कारण, {{orderedBy}} के आदेश पर विद्यालय *बंद* रहेगा।\n\n📅 बंद: *{{holidayFrom}}* से\n📅 तक: *{{holidayTo}}*\n🏫 विद्यालय फिर खुलेगा: *{{reopenDate}}*\n🚌 इन दिनों स्कूल बसें नहीं चलेंगी।\n\n📝 {{holidayNote}}\n\nकृपया बच्चे को घर पर सुरक्षित रखें। तारीखों में बदलाव हुआ तो हम संदेश भेजेंगे। धन्यवाद! 🙏",
    footerEn: "School office · Reply to this message for help",
    footerHi: "विद्यालय कार्यालय · सहायता के लिए इसी संदेश का उत्तर दें",
  },

  // ── Teachers ─────────────────────────────────────────────────
  // A parent's message relayed to a teacher through the school's number.
  // Free-form only reaches a teacher inside Meta's 24h session; this
  // template carries it any time within school hours.
  {
    familyKey: "teacher_message",
    nameEn: "Parent message for teacher",
    nameHi: "अभिभावक का शिक्षक के लिए संदेश",
    module: "general",
    category: "UTILITY",
    metaName: "bhb_teacher_message",
    headerFormat: "TEXT",
    headerTextEn: "Message from a parent",
    headerTextHi: "अभिभावक का संदेश",
    bodyEn:
      "Hello {{staffName}} 🙏\n\nA parent has sent you a message through the school:\n\n👧 Student: *{{childName}}* ({{classLabel}})\n👤 From: {{guardianName}}\n\n💬 \"{{messageText}}\"\n\nPlease reply in the staff app or call the parent. Parents are told teachers respond between 8 AM and 8 PM. Thank you!",
    bodyHi:
      "नमस्ते {{staffName}} जी 🙏\n\nएक अभिभावक ने विद्यालय के माध्यम से आपको संदेश भेजा है:\n\n👧 छात्र: *{{childName}}* ({{classLabel}})\n👤 भेजने वाले: {{guardianName}}\n\n💬 \"{{messageText}}\"\n\nकृपया स्टाफ ऐप में उत्तर दें या अभिभावक को फ़ोन करें। अभिभावकों को बताया गया है कि शिक्षक सुबह 8 से रात 8 बजे के बीच उत्तर देते हैं। धन्यवाद!",
    footerEn: "School office · Sent via the parent app",
    footerHi: "विद्यालय कार्यालय · पैरेंट ऐप के माध्यम से भेजा गया",
  },
];

function buildSeedTemplate(
  def: SeedDef,
  language: WaTemplateLanguage,
): WaTemplate {
  const isHi = language === "hi";
  const body = isHi ? def.bodyHi : def.bodyEn;
  const headerText = isHi
    ? def.headerTextHi || def.headerTextEn || ""
    : def.headerTextEn || "";
  const footer = isHi ? def.footerHi || def.footerEn || "" : def.footerEn || "";
  const name = isHi ? def.nameHi : def.nameEn;
  const now = nowIso();
  const carousel = (def.carousel || []).map((c, i) => ({
    ...c,
    id: `card_${def.familyKey}_${language}_${i}`,
  }));
  return {
    id: `tpl_${def.familyKey}_${language}`,
    familyKey: def.familyKey,
    name,
    module: def.module,
    category: def.category,
    language,
    status: "pending",
    metaName: def.metaName,
    metaLanguage: language === "hi" ? "hi" : "en",
    metaTemplateId: "",
    rejectionReason: "",
    quality: "UNKNOWN",
    qualityUpdatedAt: "",
    syncedAt: "",
    headerFormat: def.headerFormat || "NONE",
    headerText,
    body,
    footer,
    buttons: (isHi ? def.buttonsHi || def.buttons : def.buttons) || [],
    variables: extractVariables(
      [headerText, body, footer, ...carousel.map((c) => c.body)].join("\n"),
    ),
    mediaUrl: def.mediaUrl || "",
    mediaFileName: "",
    carousel,
    localFallbackBody: body,
    paused: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function seedWaTemplates(): WaTemplate[] {
  const out: WaTemplate[] = [];
  for (const def of SEED_DEFS) {
    out.push(buildSeedTemplate(def, "en"));
    out.push(buildSeedTemplate(def, "hi"));
  }
  return out;
}

export function emptyWaTemplates(): WaTemplatesState {
  return {
    version: 1,
    templates: seedWaTemplates(),
    lastMetaSyncAt: "",
    audit: [],
    senders: [],
    moduleSenders: {},
  };
}

function normalizeTemplate(raw: Partial<WaTemplate> | null): WaTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  const familyKey = String(raw.familyKey || "").trim();
  if (!id || !familyKey) return null;
  const language: WaTemplateLanguage = raw.language === "hi" ? "hi" : "en";
  const status = (
    ["draft", "pending", "approved", "rejected", "paused"] as const
  ).includes(raw.status as WaTemplateStatus)
    ? (raw.status as WaTemplateStatus)
    : "pending";
  const category = (
    ["UTILITY", "MARKETING", "AUTHENTICATION"] as const
  ).includes(raw.category as WaTemplateCategory)
    ? (raw.category as WaTemplateCategory)
    : "UTILITY";
  const body = String(raw.body || "");
  return {
    id,
    familyKey,
    name: String(raw.name || familyKey),
    module: (raw.module as WaTemplateModule) || "general",
    category,
    language,
    status,
    metaName: String(raw.metaName || familyKey),
    metaLanguage: String(raw.metaLanguage || language),
    metaTemplateId: String(raw.metaTemplateId || ""),
    rejectionReason: String(raw.rejectionReason || ""),
    quality: (
      ["GREEN", "YELLOW", "RED", "UNKNOWN"] as const
    ).includes(raw.quality as WaTemplateQuality)
      ? (raw.quality as WaTemplateQuality)
      : "UNKNOWN",
    qualityUpdatedAt: String(raw.qualityUpdatedAt || ""),
    syncedAt: String(raw.syncedAt || ""),
    headerFormat: (raw.headerFormat as WaHeaderFormat) || "NONE",
    headerText: String(raw.headerText || ""),
    body,
    footer: String(raw.footer || ""),
    buttons: Array.isArray(raw.buttons) ? raw.buttons : [],
    variables: Array.isArray(raw.variables)
      ? raw.variables.map(String)
      : extractVariables(body),
    mediaUrl: String(raw.mediaUrl || ""),
    mediaFileName: String(raw.mediaFileName || ""),
    carousel: Array.isArray(raw.carousel)
      ? raw.carousel.map((c, i) => ({
          id: String(c?.id || `card_${i}`),
          headerFormat:
            c?.headerFormat === "VIDEO" || c?.headerFormat === "IMAGE"
              ? c.headerFormat
              : "NONE",
          mediaUrl: String(c?.mediaUrl || ""),
          mediaFileName: String(c?.mediaFileName || ""),
          body: String(c?.body || ""),
          buttons: Array.isArray(c?.buttons) ? c.buttons : [],
        }))
      : [],
    localFallbackBody: String(raw.localFallbackBody || body),
    paused: !!raw.paused,
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
  };
}

export function normalizeWaTemplatesState(
  raw: Partial<WaTemplatesState> | null,
): WaTemplatesState {
  const seeded = seedWaTemplates();
  if (!raw || !Array.isArray(raw.templates) || raw.templates.length === 0) {
    return emptyWaTemplates();
  }
  const parsed = raw.templates
    .map((t) => normalizeTemplate(t as Partial<WaTemplate>))
    .filter((t): t is WaTemplate => !!t);
  const byId = new Map(parsed.map((t) => [t.id, t]));
  // Merge missing seed families so catalog stays complete after upgrades
  for (const s of seeded) {
    const cur = byId.get(s.id);
    if (!cur) {
      byId.set(s.id, s);
      continue;
    }
    const refreshed = refreshSeedFurniture(cur, s);
    if (refreshed !== cur) byId.set(s.id, refreshed);
  }
  return {
    version: 1,
    templates: [...byId.values()].sort((a, b) =>
      `${a.module}:${a.familyKey}:${a.language}`.localeCompare(
        `${b.module}:${b.familyKey}:${b.language}`,
      ),
    ),
    lastMetaSyncAt: String(raw.lastMetaSyncAt || ""),
    audit: Array.isArray(raw.audit)
      ? raw.audit.slice(0, 200).map((a) => ({
          at: String(a?.at || ""),
          by: String(a?.by || ""),
          action: String(a?.action || ""),
          detail: String(a?.detail || ""),
        }))
      : [],
    senders: normalizeSenders(raw.senders),
    moduleSenders: normalizeModuleSenders(raw.moduleSenders),
  };
}

/**
 * Give a never-submitted, never-reworded seed template the header, footer
 * and buttons its seed now carries.
 *
 * The registry keeps whatever it was seeded with; a later release that adds
 * a header to the seed would otherwise reach only a fresh install. The 2026-09
 * polish added a title line and tappable replies to every parent template,
 * and production held sixty templates seeded before that — identical body,
 * no header, no buttons — that no one had ever submitted.
 *
 * The rule is deliberately narrow, and only ever ADDS:
 *   - nothing already on Meta is touched (a metaTemplateId, or approved);
 *   - the body must still be the seed's own words — a reworded template is
 *     the school's, and its furniture is theirs to decide;
 *   - a header, footer or button set the template already has is kept.
 */
function refreshSeedFurniture(cur: WaTemplate, seed: WaTemplate): WaTemplate {
  if (cur.metaTemplateId || cur.status === "approved") return cur;
  if (cur.body !== seed.body) return cur;
  let next = cur;
  const noHeader = cur.headerFormat === "NONE" && !cur.headerText.trim();
  if (noHeader && seed.headerFormat === "TEXT" && seed.headerText.trim()) {
    next = { ...next, headerFormat: "TEXT", headerText: seed.headerText };
  }
  if (!cur.footer.trim() && seed.footer.trim()) {
    next = { ...next, footer: seed.footer };
  }
  if (cur.buttons.length === 0 && seed.buttons.length > 0) {
    next = { ...next, buttons: seed.buttons };
  }
  if (next === cur) return cur;
  return {
    ...next,
    variables: collectTemplateVariables({
      headerText: next.headerText,
      body: next.body,
      footer: next.footer,
      carousel: next.carousel,
    }),
  };
}

export type SeedQuickReplyMatch = {
  familyKey: string;
  language: WaTemplateLanguage;
  label: string;
};

/**
 * Was this inbound text a tap on one of the school's own template buttons?
 *
 * A quick-reply tap arrives as the button's label — "Already paid", "बच्चा
 * अस्वस्थ है" — and the parent bot would otherwise read it as free text:
 * "Child is unwell" matched the *child* keyword and listed the family's
 * children; "This is a mistake" got the keyword menu. A parent who tapped the
 * button the school offered deserves an acknowledgement and a person, so the
 * caller treats a match as a hand-off to the office.
 */
export function matchSeedQuickReply(text: string): SeedQuickReplyMatch | null {
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;
  for (const def of SEED_DEFS) {
    for (const [language, buttons] of [
      ["en", def.buttons ?? []],
      ["hi", def.buttonsHi ?? def.buttons ?? []],
    ] as const) {
      for (const b of buttons) {
        if (b.type === "QUICK_REPLY" && b.text.trim().toLowerCase() === t) {
          return { familyKey: def.familyKey, language, label: b.text };
        }
      }
    }
  }
  return null;
}

/** What the bot says back when a parent taps a template button. */
export function quickReplyAcknowledgement(match: SeedQuickReplyMatch): string {
  return match.language === "hi"
    ? "धन्यवाद 🙏 आपका उत्तर विद्यालय कार्यालय तक पहुँच गया है। हम शीघ्र ही आपसे संपर्क करेंगे।"
    : "Thank you 🙏 Your reply has reached the school office. We will get back to you shortly.";
}

/**
 * The seed's own text for one family in one language — what a fresh install
 * would register on Meta. Preview screens that show "what the parent will
 * read" derive from this rather than keeping a second copy of the words.
 */
export function seedTemplateText(
  familyKey: string,
  language: WaTemplateLanguage,
): { body: string; variables: string[]; metaName: string } | null {
  const t = seedTemplateFor(familyKey, language);
  if (!t) return null;
  return { body: t.body, variables: t.variables, metaName: t.metaName };
}

/** The whole seed template for a family in one language, or null. */
export function seedTemplateFor(
  familyKey: string,
  language: WaTemplateLanguage,
): WaTemplate | null {
  const def = SEED_DEFS.find((d) => d.familyKey === familyKey);
  return def ? buildSeedTemplate(def, language) : null;
}

/**
 * A registry template re-dressed in its seed's current words — body, title
 * line, footer, buttons — with its identity (id, Meta id, status, sender
 * routing) untouched. This is the explicit "restyle what is already on Meta"
 * step; normalizeWaTemplatesState deliberately never does it by itself.
 */
export function withSeedText(t: WaTemplate): WaTemplate {
  const seed = seedTemplateFor(t.familyKey, t.language);
  if (!seed) return t;
  return {
    ...t,
    headerFormat: seed.headerFormat,
    headerText: seed.headerText,
    body: seed.body,
    footer: seed.footer,
    buttons: seed.buttons,
    carousel: t.carousel.length ? t.carousel : seed.carousel,
    variables: seed.variables,
    localFallbackBody: seed.body,
  };
}

export function loadWaTemplates(): WaTemplatesState {
  if (typeof window === "undefined") return emptyWaTemplates();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = emptyWaTemplates();
      writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return normalizeWaTemplatesState(
      JSON.parse(raw) as Partial<WaTemplatesState>,
    );
  } catch {
    return emptyWaTemplates();
  }
}

export function writeWaTemplatesLocalRaw(state: WaTemplatesState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(normalizeWaTemplatesState(state)),
  );
  window.dispatchEvent(new CustomEvent("bhb-wa-templates"));
}

/**
 * Exactly one default, no blanks, ids kept stable.
 *
 * A registry with two defaults, or none, is worse than an empty one: the send
 * path would pick whichever came first in an array whose order nobody
 * controls. If the data disagrees, the FIRST usable number wins and the rest
 * are demoted — deterministic beats clever.
 */
function normalizeSenders(raw: unknown): WaSenderNumber[] {
  if (!Array.isArray(raw)) return [];
  const out: WaSenderNumber[] = [];
  for (const r of raw) {
    const o = (r ?? {}) as Partial<WaSenderNumber>;
    const phoneNumberId = String(o.phoneNumberId || "").trim();
    if (!phoneNumberId) continue;
    out.push({
      id: String(o.id || "").trim() || nid("was"),
      label: String(o.label || "").trim() || phoneNumberId,
      phoneNumberId,
      displayNumber: String(o.displayNumber || "").trim(),
      isDefault: false,
      paused: !!o.paused,
    });
  }
  const wanted = (raw as Partial<WaSenderNumber>[]).findIndex((r) => r?.isDefault);
  const firstUsable = out.findIndex((sd) => !sd.paused);
  const idx = wanted >= 0 && wanted < out.length && !out[wanted].paused
    ? wanted
    : firstUsable;
  if (idx >= 0) out[idx].isDefault = true;
  return out;
}

function normalizeModuleSenders(
  raw: unknown,
): Partial<Record<WaTemplateModule, string>> {
  const out: Partial<Record<WaTemplateModule, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(v || "").trim();
    if (id) out[k as WaTemplateModule] = id;
  }
  return out;
}

export function waTemplatesIsEmpty(state: WaTemplatesState): boolean {
  return (state.templates?.length ?? 0) === 0;
}

export function saveWaTemplates(state: WaTemplatesState): void {
  if (typeof window === "undefined") return;
  const next = normalizeWaTemplatesState(state);
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("bhb-wa-templates"));
  void import("@/lib/waTemplatesPersistence").then(({ scheduleWaTemplatesSync }) => {
    scheduleWaTemplatesSync(next);
  });
}

export function appendWaTemplatesAudit(
  state: WaTemplatesState,
  by: string,
  action: string,
  detail: string,
): WaTemplatesState {
  return {
    ...state,
    audit: [
      { at: nowIso(), by, action, detail },
      ...state.audit,
    ].slice(0, 200),
  };
}

export function listApprovedTemplates(
  state: WaTemplatesState,
  opts?: { language?: WaTemplateLanguage; module?: WaTemplateModule },
): WaTemplate[] {
  return state.templates.filter((t) => {
    if (t.status !== "approved" || t.paused) return false;
    if (opts?.language && t.language !== opts.language) return false;
    if (opts?.module && t.module !== opts.module) return false;
    return true;
  });
}

/**
 * The approved template for ONE message family, in the family's language.
 *
 * Falling back across template FAMILIES is never right. Selecting "the first
 * approved template in the fees module matching the family's language" meant
 * that on 2026-09-07 a Hindi-preferring family was sent `bhb_fee_pay_link` —
 * a "pay this link" message — moments after paying at the counter, because
 * that happened to be the first approved Hindi template in the module.
 *
 * The fallback for "no Hindi receipt" is the ENGLISH RECEIPT, never a
 * different message. Returns undefined when the family has no approved
 * template at all; the caller must then not claim to have sent one.
 */
export function pickTemplateForFamily(
  approved: WaTemplate[],
  familyKey: string,
  wantLang: WaTemplateLanguage,
): WaTemplate | undefined {
  const family = approved.filter((t) => t.familyKey === familyKey);
  return (
    family.find((t) => t.language === wantLang) ??
    family.find((t) => t.language === "en") ??
    family[0]
  );
}

/**
 * Positional variables for a Meta template send, in the order the template
 * itself declares.
 *
 * Meta rejects a send whose parameter count does not match the registered
 * template, so these can never be hardcoded: `bhb_fee_receipt` takes five
 * (receiptNo, childName, feeDue, paidOn, schoolName) and the receipt sender
 * supplied two, which would have been refused even once the template was
 * approved.
 *
 * A blank parameter is also refused, so an unfilled name becomes "—" rather
 * than "". A receipt that names a field it could not fill still arrives; one
 * that will not send does not.
 */
export function templateVariablePositions(
  tpl: Pick<WaTemplate, "variables">,
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    (tpl.variables ?? []).map((name, i) => [
      String(i + 1),
      values[name] || "\u2014",
    ]),
  );
}

/**
 * Is this template family usable at all?
 *
 * A family is BOTH languages or it is nothing. The school writes to families
 * in Hindi or English and the parent chooses which; a family approved only in
 * English silently sends English to a Hindi household, and a family approved
 * only in Hindi does the reverse. On 2026-09-07 the fee module had exactly
 * that shape — bhb_fee_pay_link approved in hi and pending in en — and the
 * receipt sender, reaching for "any approved fees template in this language",
 * would have told a family who had just paid at the counter to pay a link.
 *
 * So the resolver refuses a half-approved family outright rather than picking
 * the half that exists.
 */
export function templateFamilyReady(
  state: WaTemplatesState,
  familyKey: string,
): { ready: true } | { ready: false; missing: WaTemplateLanguage[] } {
  const missing: WaTemplateLanguage[] = [];
  for (const lang of ["en", "hi"] as WaTemplateLanguage[]) {
    const t = state.templates.find(
      (x) =>
        x.familyKey === familyKey &&
        x.language === lang &&
        x.status === "approved" &&
        !x.paused,
    );
    if (!t) missing.push(lang);
  }
  return missing.length === 0 ? { ready: true } : { ready: false, missing };
}

/**
 * The number a given template sends from.
 *
 * Per-template override first, then the module's number, then the school's
 * default, then the single env-configured number. The chain exists so that
 * adding a second number is a Masters decision rather than a deploy, and so
 * that a module nobody has routed still sends rather than silently failing.
 */
export function resolveSenderNumber(
  state: WaTemplatesState,
  template: Pick<WaTemplate, "module" | "senderNumberId">,
): WaSenderNumber | null {
  const live = (state.senders ?? []).filter((sd) => !sd.paused);
  const byId = (id?: string) =>
    id ? live.find((sd) => sd.id === id) ?? null : null;
  return (
    byId(template.senderNumberId) ||
    byId(state.moduleSenders?.[template.module]) ||
    live.find((sd) => sd.isDefault) ||
    null
  );
}

export type TemplateForSend =
  | {
      ok: true;
      template: WaTemplate;
      /** null = fall back to the env-configured number. */
      sender: WaSenderNumber | null;
    }
  | { ok: false; reason: string };

/**
 * THE resolver. Every sender should come through here.
 *
 * Before this, each sender chose its own way — the fee receipt by family and
 * language, others by "first approved template in the module" — which is why
 * adding a template in Masters did not reliably change what went out, and why
 * a Hindi family could receive the wrong message entirely.
 *
 * `language` is the FAMILY's choice, never the sender's. There is no argument
 * here for overriding it, on purpose.
 */
export function resolveTemplateForSend(input: {
  state: WaTemplatesState;
  familyKey: string;
  language: WaTemplateLanguage;
}): TemplateForSend {
  const { state, familyKey, language } = input;
  const ready = templateFamilyReady(state, familyKey);
  if (!ready.ready) {
    return {
      ok: false,
      reason:
        `The "${familyKey}" template is only approved in ` +
        `${ready.missing.length === 2 ? "neither language" : ready.missing[0] === "hi" ? "English" : "Hindi"}` +
        `. Both Hindi and English must be approved before the school sends it, ` +
        `so a family always gets the language they chose.`,
    };
  }
  const template = state.templates.find(
    (t) =>
      t.familyKey === familyKey &&
      t.language === language &&
      t.status === "approved" &&
      !t.paused,
  );
  if (!template) {
    return { ok: false, reason: `No approved "${familyKey}" template in ${language}` };
  }
  return { ok: true, template, sender: resolveSenderNumber(state, template) };
}

export function getTemplateById(
  state: WaTemplatesState,
  id: string,
): WaTemplate | undefined {
  return state.templates.find((t) => t.id === id);
}

export function getTemplateFamily(
  state: WaTemplatesState,
  familyKey: string,
): WaTemplate[] {
  return state.templates.filter((t) => t.familyKey === familyKey);
}

export function updateTemplateLocal(
  state: WaTemplatesState,
  id: string,
  patch: Partial<
    Pick<
      WaTemplate,
      | "name"
      | "body"
      | "footer"
      | "headerText"
      | "localFallbackBody"
      | "mediaUrl"
      | "mediaFileName"
      | "senderNumberId"
      | "headerFormat"
      | "headerText"
      | "carousel"
      | "paused"
      | "status"
      | "metaName"
      | "rejectionReason"
      | "footer"
      | "buttons"
    >
  >,
  by: string,
): WaTemplatesState {
  const templates = state.templates.map((t) => {
    if (t.id !== id) return t;
    const next = {
      ...t,
      ...patch,
      variables: collectTemplateVariables({
        headerText: patch.headerText ?? t.headerText,
        body: patch.body ?? t.body,
        footer: patch.footer ?? t.footer,
        carousel: patch.carousel ?? t.carousel,
      }),
      updatedAt: nowIso(),
    };
    return next;
  });
  return appendWaTemplatesAudit(
    { ...state, templates },
    by,
    "update",
    `Updated ${id}`,
  );
}

/**
 * Sample values for Meta template review examples.
 *
 * Meta's reviewer sees these in place of the variables, so every one must
 * read like the real thing. This used to fall back to the variable's own
 * NAME — a reviewer reading "busNo" where a bus number should be, or
 * "actionTaken" as a sentence, has a reason to reject — so the catalogue in
 * WA_TEMPLATE_VARIABLES is the source, with a few overrides that read better
 * on the school's own domain.
 */
export function sampleValueForWaVar(name: string): string {
  const overrides: Record<string, string> = {
    childName: "Aarav",
    studentName: "Aarav",
    registerLink: "https://bhbinternational.school/register",
    payLink: "https://bhbinternational.school/pay",
    ptmLink: "https://bhbinternational.school/parent",
    feeDue: "₹5,000",
    className: "Class 5A",
    date: "22 Jul 2026",
    time: "10:00 AM",
    otp: "123456",
  };
  if (overrides[name]) return overrides[name]!;
  const fromCatalogue = WA_TEMPLATE_VARIABLES.find((v) => v.key === name)?.sample;
  return fromCatalogue || "Sample";
}

function positionalizeTemplateText(
  text: string,
  variables: string[],
): { text: string; examples: string[] } {
  let out = text;
  const examples: string[] = [];
  variables.forEach((v, i) => {
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(v)}\\s*\\}\\}`, "g");
    out = out.replace(re, `{{${i + 1}}}`);
    examples.push(sampleValueForWaVar(v));
  });
  return { text: out, examples };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build Meta Graph API payload to create + submit a message template. */
export function buildMetaTemplateCreatePayload(template: WaTemplate): {
  name: string;
  language: string;
  category: WaTemplateCategory;
  components: Record<string, unknown>[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const metaNameEarly = (template.metaName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 512);
  if (!metaNameEarly) {
    warnings.push("Meta template name is required (snake_case, e.g. bhb_fee_reminder).");
  }

  if (template.category === "AUTHENTICATION") {
    // Meta generates the message text for AUTHENTICATION templates itself
    // from these structured flags — custom BODY/HEADER/FOOTER text (used
    // only for local preview/fallback) is not submitted to Meta. Meta also
    // requires exactly one OTP-type button on every AUTHENTICATION template
    // (rejects creation outright otherwise) — COPY_CODE fits a web/app login
    // flow; ONE_TAP is only for a native app with a registered signature hash.
    return {
      name: metaNameEarly,
      language: template.metaLanguage || template.language,
      category: template.category,
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 10 },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
      ],
      warnings,
    };
  }

  const components: Record<string, unknown>[] = [];

  if (template.headerFormat === "TEXT" && template.headerText.trim()) {
    const vars = extractVariables(template.headerText);
    const pos = positionalizeTemplateText(template.headerText, vars);
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: pos.text.slice(0, 60),
      ...(vars.length ? { example: { header_text: pos.examples } } : {}),
    });
  } else if (
    template.headerFormat !== "NONE" &&
    template.headerFormat !== "TEXT"
  ) {
    warnings.push(
      `Media header (${template.headerFormat}) — create in ERP as draft, then add image/video in Meta once approved, or use a TEXT header for auto-submit.`,
    );
  }

  const bodyVars = extractVariables(template.body);
  const bodyPos = positionalizeTemplateText(template.body, bodyVars);
  components.push({
    type: "BODY",
    text: bodyPos.text.slice(0, 1024),
    example: {
      body_text: [
        bodyVars.length ? bodyPos.examples : ["Sample"],
      ],
    },
  });

  if (template.footer.trim()) {
    components.push({
      type: "FOOTER",
      text: template.footer.slice(0, 60),
    });
  }

  if (template.buttons.length) {
    const buttons = template.buttons.slice(0, 3).map((b) => {
      if (b.type === "QUICK_REPLY") {
        return { type: "QUICK_REPLY", text: b.text.slice(0, 25) };
      }
      if (b.type === "URL") {
        const raw = (b.url || "https://bhbinternational.school").slice(0, 2000);
        // Meta numbers a button's single variable {{1}} and wants an example
        // that looks like a real value — never the variable's name.
        const urlVars = extractVariables(raw);
        const url = urlVars.length
          ? raw.replace(/\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}/, "{{1}}")
          : raw;
        return {
          type: "URL",
          text: b.text.slice(0, 25),
          url,
          ...(urlVars.length
            ? { example: [url.replace("{{1}}", sampleValueForWaVar(urlVars[0]!))] }
            : {}),
        };
      }
      return {
        type: "PHONE_NUMBER",
        text: b.text.slice(0, 25),
        phone_number: (b.phoneNumber || "+919451938805").replace(/\s/g, ""),
      };
    });
    components.push({ type: "BUTTONS", buttons });
  }

  return {
    name: metaNameEarly,
    language: template.metaLanguage || template.language,
    category: template.category,
    components,
    warnings,
  };
}

/**
 * Payload for editing a template that already exists on Meta
 * (POST /{template-id}). Only components travel: Meta refuses a name or
 * language on an edit, and a changed category is a separate decision.
 */
export function buildMetaTemplateEditPayload(template: WaTemplate): {
  components: Record<string, unknown>[];
  warnings: string[];
} {
  const full = buildMetaTemplateCreatePayload(template);
  return { components: full.components, warnings: full.warnings };
}

export type WaTemplateLayoutKind =
  | "text"
  | "image"
  | "video"
  | "document"
  | "carousel";

export type WaTemplateContentPurpose =
  | "fee_reminder"
  | "ptm"
  | "homework"
  | "transport"
  | "admission"
  | "general";

export const WA_TEMPLATE_CONTENT_SNIPPETS: {
  id: WaTemplateContentPurpose;
  label: string;
  module: WaTemplateModule;
  header: string;
  body: string;
  footer: string;
}[] = [
  // Starter text in the same shape as every seeded template: a greeting by
  // name, the facts on their own lines with a small icon each, one clear thing
  // to do, and a sign-off. Footers are plain text — Meta refuses a variable
  // there, so "{{schoolName}}" in a footer was a guaranteed rejection.
  {
    id: "fee_reminder",
    label: "Fee reminder",
    module: "fees",
    header: "Fee reminder",
    body:
      "Namaste {{guardianName}} ji 🙏\n\nA friendly reminder that {{childName}}'s school fee ({{classLabel}}) is due:\n\n💰 Amount: *{{feeDue}}*\n📅 Due by: *{{dueDate}}*\n\nPay in a minute from your phone — UPI, card or net banking:\n🔗 {{payLink}}\n\nYour receipt arrives on WhatsApp the moment the payment goes through. Thank you! 🙏",
    footer: "Fee counter · Reply to this message for help",
  },
  {
    id: "ptm",
    label: "PTM invite",
    module: "ptm",
    header: "Parent-Teacher Meeting",
    body:
      "Namaste {{guardianName}} ji 🙏\n\nYou are invited to the Parent–Teacher Meeting for {{childName}}:\n\n📅 Date: *{{ptmDate}}*\n⏰ Time: *{{ptmTime}}*\n\nPick a slot that suits you:\n🔗 {{ptmLink}}\n\nA short conversation with the class teacher makes a real difference. We look forward to meeting you! 🌼",
    footer: "Class teacher · Reply to this message for help",
  },
  {
    id: "homework",
    label: "Homework published",
    module: "homework",
    header: "New homework",
    body:
      "Namaste 🙏 New homework for *{{classLabel}}* is up:\n\n📘 Subject: *{{subject}}*\n📝 Work: {{homeworkTitle}}\n\nOpen the parent app for the full details — and tap *Ask tutor* there if {{childName}} needs a hand with it. 🎓\n\n— {{schoolName}}, with thanks 🙏",
    footer: "Class teacher · Open the parent app for details",
  },
  {
    id: "transport",
    label: "Transport update",
    module: "transport",
    header: "Bus update",
    body:
      "Namaste {{guardianName}} ji 🙏\n\n🚌 An update on {{childName}}'s school bus:\n\n📍 Route: *{{routeName}}*\n🕖 Expected at your stop: *{{expectedTime}}*\n\nThis is the scheduled time, not the bus's live position. Please be at the stop a few minutes early.\n\nHave a good day! 🌼",
    footer: "Transport desk · Reply to this message for help",
  },
  {
    id: "admission",
    label: "Admission follow-up",
    module: "admissions",
    header: "Admission enquiry",
    body:
      "Namaste {{guardianName}} ji 🙏\n\nThank you for your interest in *{{schoolName}}* for {{childName}}. 🎒\n\nThe next step is a short online registration — it takes about 5 minutes:\n🔗 {{registerLink}}\n\nOnce done, our admissions team will call you to fix a campus visit. We look forward to welcoming your family! 🌼",
    footer: "Admissions desk · Reply to this message for help",
  },
  {
    id: "general",
    label: "General notice",
    module: "general",
    header: "School notice",
    body:
      "Namaste {{guardianName}} ji 🙏\n\n📢 *{{noticeTitle}}*\n\n{{noticeBody}}\n\nPlease read carefully and reply to this message if you have a question.\n\n— {{schoolName}}, with thanks 🙏",
    footer: "School office · Reply to this message for help",
  },
];

export const WA_TEMPLATE_LAYOUT_OPTIONS: {
  id: WaTemplateLayoutKind;
  label: string;
  description: string;
  headerFormat: WaHeaderFormat;
}[] = [
  {
    id: "text",
    label: "Text only",
    description: "Body message with variables — no media header.",
    headerFormat: "NONE",
  },
  {
    id: "image",
    label: "Image header",
    description: "JPG / PNG banner on top + body text.",
    headerFormat: "IMAGE",
  },
  {
    id: "video",
    label: "Video header",
    description: "MP4 clip on top + body text.",
    headerFormat: "VIDEO",
  },
  {
    id: "document",
    label: "Document header",
    description: "PDF attachment on top + body text.",
    headerFormat: "DOCUMENT",
  },
  {
    id: "carousel",
    label: "Carousel",
    description: "Multiple swipeable cards — image per card + text.",
    headerFormat: "NONE",
  },
];

export function createDraftWaTemplate(
  state: WaTemplatesState,
  opts: {
    name: string;
    metaName: string;
    module: WaTemplateModule;
    category?: WaTemplateCategory;
    language: WaTemplateLanguage;
    body: string;
    footer?: string;
    buttons?: WaTemplateButton[];
    layoutKind?: WaTemplateLayoutKind;
    headerFormat?: WaHeaderFormat;
    headerText?: string;
    mediaUrl?: string;
    mediaFileName?: string;
    carousel?: Omit<WaCarouselCard, "id">[];
    localFallbackBody?: string;
    by: string;
  },
): { state: WaTemplatesState; template: WaTemplate } {
  const body = opts.body.trim();
  const metaName = opts.metaName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  const layout =
    WA_TEMPLATE_LAYOUT_OPTIONS.find((o) => o.id === opts.layoutKind) ||
    WA_TEMPLATE_LAYOUT_OPTIONS[0]!;
  const headerFormat = opts.headerFormat ?? layout.headerFormat;
  const carousel =
    opts.layoutKind === "carousel"
      ? (opts.carousel || defaultCarouselCards()).map((c, i) => ({
          id: nid(`wcc_${i}`),
          headerFormat: c.headerFormat || "IMAGE",
          mediaUrl: c.mediaUrl || "",
          mediaFileName: c.mediaFileName || "",
          body: c.body || "",
          buttons: c.buttons || [],
        }))
      : (opts.carousel || []).map((c, i) => ({
          id: nid(`wcc_${i}`),
          ...c,
        }));
  const tpl: WaTemplate = {
    id: nid("wtp"),
    familyKey: `custom_${metaName}`,
    name: opts.name.trim() || metaName,
    module: opts.module,
    category: opts.category || "UTILITY",
    language: opts.language,
    status: "draft",
    metaName,
    metaLanguage: opts.language,
    metaTemplateId: "",
    rejectionReason: "",
    quality: "UNKNOWN",
    qualityUpdatedAt: "",
    syncedAt: "",
    headerFormat,
    headerText: opts.headerText || "",
    body,
    footer: opts.footer || "",
    buttons: opts.buttons || [],
    variables: collectTemplateVariables({
      headerText: opts.headerText,
      body,
      footer: opts.footer,
      carousel,
    }),
    mediaUrl: opts.mediaUrl || "",
    mediaFileName: opts.mediaFileName || "",
    carousel,
    localFallbackBody: opts.localFallbackBody?.trim() || body,
    paused: false,
    updatedAt: nowIso(),
    createdAt: nowIso(),
  };
  const nextState = appendWaTemplatesAudit(
    { ...state, templates: [...state.templates, tpl] },
    opts.by,
    "create_draft",
    tpl.metaName,
  );
  return { state: nextState, template: tpl };
}

function defaultCarouselCards(): Omit<WaCarouselCard, "id">[] {
  return [
    {
      headerFormat: "IMAGE",
      body: "{{schoolName}} — card 1",
      buttons: [],
    },
    {
      headerFormat: "IMAGE",
      body: "{{schoolName}} — card 2",
      buttons: [],
    },
  ];
}

export function markTemplateSubmittedToMeta(
  state: WaTemplatesState,
  id: string,
  metaTemplateId: string,
  by: string,
): WaTemplatesState {
  const templates = state.templates.map((t) =>
    t.id === id
      ? {
          ...t,
          status: "pending" as const,
          metaTemplateId,
          rejectionReason: "",
          syncedAt: nowIso(),
          updatedAt: nowIso(),
        }
      : t,
  );
  return appendWaTemplatesAudit(
    { ...state, templates, lastMetaSyncAt: nowIso() },
    by,
    "submit_meta",
    metaTemplateId,
  );
}

/**
 * After an in-place edit on Meta: back to pending, Meta id kept.
 *
 * The id is the same template — Meta reviews the new components under it —
 * so senders that resolve by family keep finding it, and the status webhook
 * flips it back to approved with no manual step.
 */
export function markTemplateEditedOnMeta(
  state: WaTemplatesState,
  id: string,
  by: string,
): WaTemplatesState {
  const templates = state.templates.map((t) =>
    t.id === id
      ? {
          ...t,
          status: "pending" as const,
          rejectionReason: "",
          syncedAt: nowIso(),
          updatedAt: nowIso(),
        }
      : t,
  );
  const tpl = templates.find((t) => t.id === id);
  return appendWaTemplatesAudit(
    { ...state, templates, lastMetaSyncAt: nowIso() },
    by,
    "edit_meta",
    `${tpl?.metaName ?? id} (${tpl?.metaTemplateId ?? "?"})`,
  );
}

export function mapMetaTemplateStatus(
  metaStatus: string,
): WaTemplateStatus | null {
  const s = (metaStatus || "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "PENDING" || s === "IN_APPEAL" || s === "PENDING_DELETION")
    return "pending";
  if (s === "REJECTED" || s === "DISABLED") return "rejected";
  if (s === "PAUSED") return "paused";
  return null;
}

export type MetaTemplateSyncRow = {
  name: string;
  language: string;
  status: string;
  id?: string;
  rejected_reason?: string;
  category?: string;
};

/**
 * Merge Meta Graph message_templates list into registry by metaName + language.
 */
export function applyMetaTemplateSync(
  state: WaTemplatesState,
  rows: MetaTemplateSyncRow[],
  by = "meta_sync",
): WaTemplatesState {
  const templates = [...state.templates];
  const now = nowIso();
  for (const row of rows) {
    const lang: WaTemplateLanguage = (row.language || "")
      .toLowerCase()
      .startsWith("hi")
      ? "hi"
      : "en";
    const status = mapMetaTemplateStatus(row.status) || "pending";
    const idx = templates.findIndex(
      (t) =>
        t.metaName === row.name &&
        (t.metaLanguage === row.language || t.language === lang),
    );
    if (idx >= 0) {
      const cur = templates[idx]!;
      templates[idx] = {
        ...cur,
        status: status === "paused" ? "paused" : status,
        paused: status === "paused" || cur.paused,
        metaTemplateId: row.id || cur.metaTemplateId,
        rejectionReason: row.rejected_reason || cur.rejectionReason,
        category: (row.category as WaTemplateCategory) || cur.category,
        syncedAt: now,
        updatedAt: now,
      };
    } else {
      templates.push({
        id: nid("tpl"),
        familyKey: `meta_${row.name}`,
        name: row.name,
        module: "general",
        category: (row.category as WaTemplateCategory) || "UTILITY",
        language: lang,
        status,
        metaName: row.name,
        metaLanguage: row.language || lang,
        metaTemplateId: row.id || "",
        rejectionReason: row.rejected_reason || "",
        quality: "UNKNOWN",
        qualityUpdatedAt: "",
        syncedAt: now,
        headerFormat: "NONE",
        headerText: "",
        body: "",
        footer: "",
        buttons: [],
        variables: [],
        mediaUrl: "",
        mediaFileName: "",
        carousel: [],
        localFallbackBody: "",
        paused: status === "paused",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return appendWaTemplatesAudit(
    {
      ...state,
      templates,
      lastMetaSyncAt: now,
    },
    by,
    "meta_sync",
    `Synced ${rows.length} Meta templates`,
  );
}

export function applyMetaTemplateStatusUpdate(
  state: WaTemplatesState,
  evt: {
    message_template_name?: string;
    message_template_language?: string;
    event?: string;
    reason?: string;
  },
): WaTemplatesState {
  const name = evt.message_template_name || "";
  const lang = evt.message_template_language || "";
  if (!name) return state;
  const mapped = mapMetaTemplateStatus(evt.event || "");
  if (!mapped) return state;
  const nextStatus: WaTemplateStatus =
    mapped === "paused" ? "paused" : mapped;
  const templates: WaTemplate[] = state.templates.map((t) => {
    if (t.metaName !== name) return t;
    if (lang && t.metaLanguage !== lang && t.language !== lang.slice(0, 2)) {
      return t;
    }
    return {
      ...t,
      status: nextStatus,
      paused: mapped === "paused",
      rejectionReason: evt.reason || t.rejectionReason,
      syncedAt: nowIso(),
      updatedAt: nowIso(),
    };
  });
  return {
    ...state,
    templates,
    lastMetaSyncAt: nowIso(),
  };
}

/** Apply a message_template_quality_update webhook event (does not touch status). */
export function applyMetaTemplateQualityUpdate(
  state: WaTemplatesState,
  evt: {
    message_template_name?: string;
    message_template_language?: string;
    new_quality_score?: string;
  },
): WaTemplatesState {
  const name = evt.message_template_name || "";
  const lang = evt.message_template_language || "";
  if (!name) return state;
  const score = (evt.new_quality_score || "").toUpperCase();
  const quality: WaTemplateQuality = (
    ["GREEN", "YELLOW", "RED"] as const
  ).includes(score as "GREEN" | "YELLOW" | "RED")
    ? (score as WaTemplateQuality)
    : "UNKNOWN";
  const now = nowIso();
  let touched = false;
  const templates: WaTemplate[] = state.templates.map((t) => {
    if (t.metaName !== name) return t;
    if (lang && t.metaLanguage !== lang && t.language !== lang.slice(0, 2)) {
      return t;
    }
    touched = true;
    return { ...t, quality, qualityUpdatedAt: now, updatedAt: now };
  });
  if (!touched) return state;
  return { ...state, templates };
}

/** The variable a URL button carries, if any (Meta allows one, at the end). */
export function buttonUrlVariable(b: WaTemplateButton): string | null {
  if (b.type !== "URL" || !b.url) return null;
  return extractVariables(b.url)[0] ?? null;
}

/**
 * Button components for a template send — one per URL button whose target
 * carries a variable. Meta refuses a send that omits them, and a "Pay now"
 * that opens the wrong family's link is worse than one that fails, so a
 * button whose value the sender did not supply is reported, not defaulted.
 */
export function templateButtonComponents(
  tpl: Pick<WaTemplate, "buttons">,
  vars: Record<string, string>,
): {
  components: {
    type: "button";
    sub_type: "url";
    index: number;
    parameters: { type: "text"; text: string }[];
  }[];
  missing: string[];
} {
  const components: ReturnType<typeof templateButtonComponents>["components"] = [];
  const missing: string[] = [];
  (tpl.buttons ?? []).slice(0, 3).forEach((b, index) => {
    const key = buttonUrlVariable(b);
    if (!key) return;
    const value = (vars[key] ?? "").trim();
    if (!value) {
      missing.push(key);
      return;
    }
    components.push({
      type: "button",
      sub_type: "url",
      index,
      parameters: [{ type: "text", text: value.slice(0, 2000) }],
    });
  });
  return { components, missing };
}

/** Map named {{vars}} to Meta positional body parameters in declaration order. */
export function buildTemplateBodyParameters(
  template: WaTemplate,
  vars: Record<string, string>,
): { type: "text"; text: string }[] {
  return template.variables.map((key) => ({
    type: "text" as const,
    text: String(vars[key] ?? "").slice(0, 1024) || "—",
  }));
}

export function statusTone(status: WaTemplateStatus): string {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-800";
    case "pending":
      return "bg-amber-100 text-amber-900";
    case "rejected":
      return "bg-rose-100 text-rose-800";
    case "paused":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function qualityTone(quality: WaTemplateQuality): string {
  switch (quality) {
    case "GREEN":
      return "bg-emerald-100 text-emerald-800";
    case "YELLOW":
      return "bg-amber-100 text-amber-900";
    case "RED":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function moduleLabel(m: WaTemplateModule): string {
  const labels: Record<WaTemplateModule, string> = {
    admissions: "Admissions",
    fees: "Fees",
    attendance: "Attendance",
    homework: "Homework",
    exams: "Exams",
    ptm: "PTM",
    leave: "Leave",
    vault: "Vault",
    comms: "Comms",
    store: "Store",
    transport: "Transport",
    certificates: "Certificates",
    rte: "RTE",
    field: "Field",
    staff: "Staff",
    general: "General",
  };
  return labels[m] || m;
}
