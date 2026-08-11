/**
 * School-wide WhatsApp Business template registry (Meta WABA).
 * Store: localStorage `bhb_wa_templates_v1` + Supabase blob `wa_templates_state`.
 */

const STORAGE_KEY = "bhb_wa_templates_v1";

export type WaTemplateStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "paused";

export type WaTemplateCategory =
  | "UTILITY"
  | "MARKETING"
  | "AUTHENTICATION";

export type WaTemplateLanguage = "en" | "hi";

export type WaTemplateModule =
  | "admissions"
  | "fees"
  | "attendance"
  | "homework"
  | "exams"
  | "ptm"
  | "leave"
  | "vault"
  | "comms"
  | "store"
  | "transport"
  | "certificates"
  | "rte"
  | "field"
  | "staff"
  | "general";

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
  /** Free-text fallback for 24h session / wa.me */
  localFallbackBody: string;
  paused: boolean;
  updatedAt: string;
  createdAt: string;
};

export type WaTemplatesState = {
  version: 1;
  templates: WaTemplate[];
  lastMetaSyncAt: string;
  audit: { at: string; by: string; action: string; detail: string }[];
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
  { key: "docTitle", label: "Document title", group: "Vault", sample: "Fire NOC" },
  { key: "expiryDate", label: "Expiry date", group: "Vault", sample: "31 Dec 2026" },
  { key: "orderNo", label: "Store order no.", group: "Store", sample: "STR-882" },
  { key: "orderStatus", label: "Store order status", group: "Store", sample: "Ready" },
  { key: "routeName", label: "Transport route", group: "Transport", sample: "Route 3 — City" },
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
  mediaUrl?: string;
  carousel?: Omit<WaCarouselCard, "id">[];
};

const SEED_DEFS: SeedDef[] = [
  {
    familyKey: "admissions_registration_invite",
    nameEn: "Registration invite",
    nameHi: "पंजीकरण आमंत्रण",
    module: "admissions",
    category: "UTILITY",
    metaName: "bhb_registration_invite",
    bodyEn:
      "Namaste {{guardianName}}, please complete registration for *{{childName}}* at {{schoolName}}. Register: {{registerLink}}",
    bodyHi:
      "नमस्ते {{guardianName}}, कृपया {{schoolName}} में *{{childName}}* का पंजीकरण पूरा करें। लिंक: {{registerLink}}",
    footerEn: "Admissions desk",
    footerHi: "प्रवेश कार्यालय",
  },
  {
    familyKey: "admissions_fee_reminder",
    nameEn: "Registration fee reminder",
    nameHi: "पंजीकरण शुल्क अनुस्मारक",
    module: "admissions",
    category: "UTILITY",
    metaName: "bhb_registration_fee_reminder",
    bodyEn:
      "Dear {{guardianName}}, registration fee for *{{childName}}* is due: *{{feeDue}}*. Pay: {{payLink}}",
    bodyHi:
      "प्रिय {{guardianName}}, *{{childName}}* का पंजीकरण शुल्क बकाया है: *{{feeDue}}*। भुगतान: {{payLink}}",
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
      "Dear {{guardianName}}, you are invited to visit campus for *{{childName}}* counselling at {{schoolName}}. Register: {{registerLink}}",
    bodyHi:
      "प्रिय {{guardianName}}, {{schoolName}} में *{{childName}}* की काउंसलिंग हेतु कैंपस आने का निमंत्रण। पंजीकरण: {{registerLink}}",
  },
  {
    familyKey: "admissions_followup",
    nameEn: "Admission follow-up",
    nameHi: "प्रवेश फॉलो-अप",
    module: "admissions",
    category: "UTILITY",
    metaName: "bhb_admission_followup",
    bodyEn:
      "Namaste {{guardianName}}, checking in on *{{childName}}*'s admission enquiry at {{schoolName}}. Reply YES to continue or call the desk.",
    bodyHi:
      "नमस्ते {{guardianName}}, {{schoolName}} में *{{childName}}* की प्रवेश पूछताछ पर फॉलो-अप। जारी रखने के लिए YES लिखें।",
  },
  {
    familyKey: "fees_soft_reminder",
    nameEn: "Fee soft reminder",
    nameHi: "शुल्क सौम्य अनुस्मारक",
    module: "fees",
    category: "UTILITY",
    metaName: "bhb_fee_soft_reminder",
    bodyEn:
      "Dear {{guardianName}}, fee for *{{childName}}* ({{classLabel}}) is due soon: *{{feeDue}}*. Pay: {{payLink}}",
    bodyHi:
      "प्रिय {{guardianName}}, *{{childName}}* ({{classLabel}}) का शुल्क शीघ्र देय: *{{feeDue}}*। भुगतान: {{payLink}}",
  },
  {
    familyKey: "fees_stage_reminder",
    nameEn: "Fee overdue stage reminder",
    nameHi: "बकाया शुल्क चरण अनुस्मारक",
    module: "fees",
    category: "UTILITY",
    metaName: "bhb_fee_stage_reminder",
    bodyEn:
      "Dear {{guardianName}}, *{{childName}}* has overdue fees (stage {{stage}}): *{{feeDue}}*. Please clear dues: {{payLink}}",
    bodyHi:
      "प्रिय {{guardianName}}, *{{childName}}* का बकाया शुल्क (चरण {{stage}}): *{{feeDue}}*। भुगतान: {{payLink}}",
  },
  {
    familyKey: "fees_pay_link",
    nameEn: "Fee pay link",
    nameHi: "शुल्क भुगतान लिंक",
    module: "fees",
    category: "UTILITY",
    metaName: "bhb_fee_pay_link",
    bodyEn:
      "{{schoolName}}: Pay link for *{{childName}}* — amount *{{feeDue}}*: {{payLink}}",
    bodyHi:
      "{{schoolName}}: *{{childName}}* हेतु भुगतान लिंक — राशि *{{feeDue}}*: {{payLink}}",
  },
  {
    familyKey: "fees_receipt",
    nameEn: "Fee receipt share",
    nameHi: "शुल्क रसीद",
    module: "fees",
    category: "UTILITY",
    metaName: "bhb_fee_receipt",
    bodyEn:
      "Receipt {{receiptNo}} for *{{childName}}*: paid *{{feeDue}}* on {{paidOn}}. Thank you — {{schoolName}}",
    bodyHi:
      "*{{childName}}* की रसीद {{receiptNo}}: {{paidOn}} को *{{feeDue}}* प्राप्त। धन्यवाद — {{schoolName}}",
  },
  {
    familyKey: "fees_marketing_carousel",
    nameEn: "Fee offer carousel",
    nameHi: "शुल्क ऑफर कैरोसेल",
    module: "fees",
    category: "MARKETING",
    metaName: "bhb_fee_offer_carousel",
    headerFormat: "NONE",
    bodyEn: "Fee options for the new session at {{schoolName}} — swipe cards below.",
    bodyHi: "{{schoolName}} में नए सत्र के शुल्क विकल्प — नीचे कार्ड देखें।",
    carousel: [
      {
        headerFormat: "IMAGE",
        body: "Early bird concession — save on annual fees.",
        buttons: [{ type: "URL", text: "Pay now", url: "{{payLink}}" }],
      },
      {
        headerFormat: "IMAGE",
        body: "Installment plans available for {{classLabel}}.",
        buttons: [{ type: "QUICK_REPLY", text: "Know more" }],
      },
    ],
  },
  {
    familyKey: "attendance_absent",
    nameEn: "Student absent alert",
    nameHi: "छात्र अनुपस्थिति सूचना",
    module: "attendance",
    category: "UTILITY",
    metaName: "bhb_attendance_absent",
    bodyEn:
      "Dear {{guardianName}}, *{{childName}}* ({{classLabel}}) is marked absent today ({{date}}). Reply if this is incorrect.",
    bodyHi:
      "प्रिय {{guardianName}}, *{{childName}}* ({{classLabel}}) आज ({{date}}) अनुपस्थित अंकित है। गलत हो तो उत्तर दें।",
  },
  {
    familyKey: "homework_published",
    nameEn: "Homework published",
    nameHi: "गृहकार्य प्रकाशित",
    module: "homework",
    category: "UTILITY",
    metaName: "bhb_homework_published",
    bodyEn:
      "Homework for {{classLabel}} — {{subject}}: {{homeworkTitle}}. Due {{dueDate}}. — {{schoolName}}",
    bodyHi:
      "{{classLabel}} गृहकार्य — {{subject}}: {{homeworkTitle}}। अंतिम तिथि {{dueDate}}। — {{schoolName}}",
  },
  {
    familyKey: "exams_datesheet",
    nameEn: "Exam datesheet",
    nameHi: "परीक्षा डेटशीट",
    module: "exams",
    category: "UTILITY",
    metaName: "bhb_exam_datesheet",
    headerFormat: "DOCUMENT",
    bodyEn:
      "Dear {{guardianName}}, datesheet for *{{childName}}* ({{examName}}) is ready. Please check the attached schedule.",
    bodyHi:
      "प्रिय {{guardianName}}, *{{childName}}* की डेटशीट ({{examName}}) तैयार है। संलग्न समय-सारणी देखें।",
  },
  {
    familyKey: "exams_result",
    nameEn: "Exam result notify",
    nameHi: "परीक्षा परिणाम",
    module: "exams",
    category: "UTILITY",
    metaName: "bhb_exam_result",
    bodyEn:
      "Results for {{examName}} — *{{childName}}* are published. Login to parent portal for details. — {{schoolName}}",
    bodyHi:
      "{{examName}} के परिणाम — *{{childName}}* प्रकाशित। विवरण हेतु पोर्टल देखें। — {{schoolName}}",
  },
  {
    familyKey: "ptm_invite",
    nameEn: "PTM invite",
    nameHi: "अभिभावक-शिक्षक बैठक",
    module: "ptm",
    category: "UTILITY",
    metaName: "bhb_ptm_invite",
    bodyEn:
      "Dear {{guardianName}}, PTM for *{{childName}}* on {{ptmDate}} at {{ptmTime}}. Book slot: {{ptmLink}}",
    bodyHi:
      "प्रिय {{guardianName}}, *{{childName}}* की PTM {{ptmDate}} को {{ptmTime}} बजे। स्लॉट बुक करें: {{ptmLink}}",
  },
  {
    familyKey: "leave_student_status",
    nameEn: "Student leave status",
    nameHi: "छात्र अवकाश स्थिति",
    module: "leave",
    category: "UTILITY",
    metaName: "bhb_student_leave_status",
    bodyEn:
      "Leave request for *{{childName}}* is *{{leaveStatus}}* ({{leaveFrom}}–{{leaveTo}}). — {{schoolName}}",
    bodyHi:
      "*{{childName}}* का अवकाश अनुरोध *{{leaveStatus}}* है ({{leaveFrom}}–{{leaveTo}})। — {{schoolName}}",
  },
  {
    familyKey: "leave_staff_status",
    nameEn: "Staff leave status",
    nameHi: "स्टाफ अवकाश स्थिति",
    module: "staff",
    category: "UTILITY",
    metaName: "bhb_staff_leave_status",
    bodyEn:
      "Hi {{staffName}}, your leave request is *{{leaveStatus}}* ({{leaveFrom}}–{{leaveTo}}).",
    bodyHi:
      "नमस्ते {{staffName}}, आपका अवकाश अनुरोध *{{leaveStatus}}* है ({{leaveFrom}}–{{leaveTo}})।",
  },
  {
    familyKey: "vault_expiry",
    nameEn: "Document vault expiry",
    nameHi: "दस्तावेज़ समाप्ति",
    module: "vault",
    category: "UTILITY",
    metaName: "bhb_vault_expiry",
    bodyEn:
      "Reminder: document *{{docTitle}}* expires on {{expiryDate}}. Please renew. — {{schoolName}}",
    bodyHi:
      "अनुस्मारक: दस्तावेज़ *{{docTitle}}* की वैधता {{expiryDate}} को समाप्त। नवीनीकरण करें। — {{schoolName}}",
  },
  {
    familyKey: "comms_notice",
    nameEn: "School notice broadcast",
    nameHi: "विद्यालय सूचना",
    module: "comms",
    category: "UTILITY",
    metaName: "bhb_school_notice",
    bodyEn: "*{{schoolName}} notice*\n{{noticeTitle}}\n\n{{noticeBody}}",
    bodyHi: "*{{schoolName}} सूचना*\n{{noticeTitle}}\n\n{{noticeBody}}",
  },
  {
    familyKey: "store_order",
    nameEn: "Store order update",
    nameHi: "स्टोर ऑर्डर अपडेट",
    module: "store",
    category: "UTILITY",
    metaName: "bhb_store_order",
    bodyEn:
      "Store order {{orderNo}} for *{{childName}}* is *{{orderStatus}}*. Amount: {{feeDue}}. — {{schoolName}}",
    bodyHi:
      "*{{childName}}* का स्टोर ऑर्डर {{orderNo}} *{{orderStatus}}* है। राशि: {{feeDue}}। — {{schoolName}}",
  },
  {
    familyKey: "transport_fee",
    nameEn: "Transport fee reminder",
    nameHi: "परिवहन शुल्क अनुस्मारक",
    module: "transport",
    category: "UTILITY",
    metaName: "bhb_transport_fee",
    bodyEn:
      "Transport fee for *{{childName}}* (route {{routeName}}) due: *{{feeDue}}*. Pay: {{payLink}}",
    bodyHi:
      "*{{childName}}* (मार्ग {{routeName}}) का परिवहन शुल्क बकाया: *{{feeDue}}*। भुगतान: {{payLink}}",
  },
  {
    familyKey: "certificates_ready",
    nameEn: "Certificate ready",
    nameHi: "प्रमाणपत्र तैयार",
    module: "certificates",
    category: "UTILITY",
    metaName: "bhb_certificate_ready",
    bodyEn:
      "Dear {{guardianName}}, {{certType}} for *{{childName}}* is ready for collection. — {{schoolName}}",
    bodyHi:
      "प्रिय {{guardianName}}, *{{childName}}* का {{certType}} संग्रह हेतु तैयार है। — {{schoolName}}",
  },
  {
    familyKey: "rte_nudge",
    nameEn: "RTE / EWS nudge",
    nameHi: "RTE / EWS अनुस्मारक",
    module: "rte",
    category: "UTILITY",
    metaName: "bhb_rte_nudge",
    bodyEn:
      "Dear {{guardianName}}, please complete RTE/EWS documents for *{{childName}}* by {{dueDate}}. — {{schoolName}}",
    bodyHi:
      "प्रिय {{guardianName}}, कृपया *{{childName}}* के RTE/EWS दस्तावेज़ {{dueDate}} तक पूरे करें। — {{schoolName}}",
  },
  {
    familyKey: "field_survey_nudge",
    nameEn: "Field survey nudge",
    nameHi: "फील्ड सर्वे अनुस्मारक",
    module: "field",
    category: "MARKETING",
    metaName: "bhb_field_survey_nudge",
    bodyEn:
      "Hi {{guardianName}}, our team visited regarding *{{childName}}*. Complete enquiry: {{registerLink}} — {{schoolName}}",
    bodyHi:
      "नमस्ते {{guardianName}}, हमारी टीम *{{childName}}* हेतु मिली थी। पूछताछ पूरी करें: {{registerLink}} — {{schoolName}}",
  },
  {
    familyKey: "auth_parent_login_otp",
    nameEn: "Parent login OTP",
    nameHi: "पालक लॉगिन OTP",
    module: "general",
    category: "AUTHENTICATION",
    metaName: "bhb_parent_login_otp",
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
    bodyEn: "Why families choose {{schoolName}} — explore highlights.",
    bodyHi: "{{schoolName}} क्यों चुनें — मुख्य बातें देखें।",
    carousel: [
      {
        headerFormat: "IMAGE",
        body: "CBSE curriculum · strong academics",
        buttons: [
          { type: "URL", text: "Apply", url: "{{registerLink}}" },
        ],
      },
      {
        headerFormat: "IMAGE",
        body: "Sports, labs & activity clubs",
        buttons: [{ type: "QUICK_REPLY", text: "Visit campus" }],
      },
      {
        headerFormat: "IMAGE",
        body: "Safe transport & daycare options",
        buttons: [{ type: "QUICK_REPLY", text: "Call desk" }],
      },
    ],
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
    syncedAt: "",
    headerFormat: def.headerFormat || "NONE",
    headerText,
    body,
    footer,
    buttons: def.buttons || [],
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
    if (!byId.has(s.id)) byId.set(s.id, s);
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
  };
}

export function loadWaTemplates(): WaTemplatesState {
  if (typeof window === "undefined") return emptyWaTemplates();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = emptyWaTemplates();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
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

export function waTemplatesIsEmpty(state: WaTemplatesState): boolean {
  return (state.templates?.length ?? 0) === 0;
}

export function saveWaTemplates(state: WaTemplatesState): void {
  if (typeof window === "undefined") return;
  const next = normalizeWaTemplatesState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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

/** Sample values for Meta template review examples. */
export function sampleValueForWaVar(name: string): string {
  const samples: Record<string, string> = {
    guardianName: "Priya Sharma",
    childName: "Aarav",
    studentName: "Aarav",
    schoolName: "BHB International School",
    registerLink: "https://bhbinternational.school/register",
    payLink: "https://bhbinternational.school/pay",
    feeDue: "₹5,000",
    amount: "₹5,000",
    dueDate: "15 Aug 2026",
    className: "Class 5A",
    date: "22 Jul 2026",
    time: "10:00 AM",
    otp: "123456",
  };
  return samples[name] || name.slice(0, 20) || "Sample";
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
    // from these structured flags — custom BODY/HEADER/FOOTER/BUTTONS text
    // (used only for local preview/fallback) is not submitted to Meta.
    return {
      name: metaNameEarly,
      language: template.metaLanguage || template.language,
      category: template.category,
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 10 },
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
        const url = (b.url || "https://bhbinternational.school").slice(0, 2000);
        const hasVar = /\{\{/.test(url);
        return {
          type: "URL",
          text: b.text.slice(0, 25),
          url,
          ...(hasVar
            ? {
                example: [
                  url.replace(/\{\{[^}]+\}\}/g, "sample"),
                ],
              }
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
  body: string;
  footer: string;
}[] = [
  {
    id: "fee_reminder",
    label: "Fee reminder",
    module: "fees",
    body:
      "Namaste {{guardianName}}, fee of {{feeDue}} for {{childName}} ({{classLabel}}) is due by {{dueDate}}. Pay securely: {{payLink}}",
    footer: "{{schoolName}}",
  },
  {
    id: "ptm",
    label: "PTM invite",
    module: "general",
    body:
      "Dear {{guardianName}}, PTM for {{childName}} is on {{ptmDate}} at {{ptmTime}}. Book your slot: {{ptmLink}}",
    footer: "{{schoolName}}",
  },
  {
    id: "homework",
    label: "Homework published",
    module: "comms",
    body:
      "{{guardianName}}, new homework for {{childName}} ({{classLabel}}): {{homeworkTitle}} — {{subject}}.",
    footer: "{{schoolName}}",
  },
  {
    id: "transport",
    label: "Transport update",
    module: "transport",
    body:
      "Update for {{childName}}: route {{routeName}} — please check timing with transport desk.",
    footer: "{{schoolName}}",
  },
  {
    id: "admission",
    label: "Admission follow-up",
    module: "admissions",
    body:
      "Hello {{guardianName}}, thank you for your interest in {{schoolName}}. Complete registration: {{registerLink}}",
    footer: "Admissions desk",
  },
  {
    id: "general",
    label: "General notice",
    module: "general",
    body:
      "Namaste {{guardianName}}, {{noticeTitle}} — {{noticeBody}}",
    footer: "{{schoolName}}",
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
