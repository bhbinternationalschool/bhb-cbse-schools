import { flattenTemplateParam, TEMPLATE_PARAM_MAX } from "@/lib/classNoticeWa";

/** The parent app on Google Play (school.bhbinternational.parent). */
export const PARENT_APP_URL = "https://play.google.com/store/apps/details?id=school.bhbinternational.parent";

/**
 * The one notice every family gets when the school moves off personal class
 * WhatsApp groups (director, 8 Oct 2026): where class updates come from now,
 * and that fees are paid in the app — UPI, cards, net banking, and EMI on the
 * checkout page (credit-card EMI from 9 banks, debit-card and cardless EMI,
 * all enabled on the Cashfree account 8 Oct 2026).
 *
 * Hindi first (parents' default), then English, the app link once. Template
 * params take no newlines and at most TEMPLATE_PARAM_MAX characters —
 * MOVE_NOTICE_BODY_RAW is checked against that in the selftest, so a longer
 * draft fails there instead of being cut off mid-sentence in the message.
 *
 * Auto-pay is NOT promised here: it is switched off and untested (no family
 * has a mandate). Add a line only once it is on and a real mandate worked.
 */
export const MOVE_NOTICE_TITLE = "School updates & fee payment / स्कूल सूचना व फीस भुगतान";
export const MOVE_NOTICE_BODY_RAW = [
  "प्रिय अभिभावक, अब गृहकार्य, कक्षा डायरी और विद्यालय की सूचनाएँ इसी आधिकारिक स्कूल व्हाट्सऐप नंबर से और BHB International School ऐप में आएँगी।",
  "ऐप से फीस भी आसानी से भरें — UPI, कार्ड, नेट बैंकिंग, और भुगतान पेज पर कार्ड से EMI की सुविधा भी।",
  "कृपया यह नंबर 'BHB School' नाम से सेव करें और ऐप डाउनलोड करें।",
  "कुछ सप्ताह बाद कक्षा के व्हाट्सऐप ग्रुप में केवल विद्यालय ही संदेश भेजेगा।",
  "| Dear parent, homework, the class diary and school notices will now come from this official school WhatsApp number and the BHB International School app.",
  "You can also pay fees easily in the app — UPI, cards, net banking, and EMI on cards on the payment page.",
  "Please save this number as 'BHB School' and download the app:",
  PARENT_APP_URL,
  "In a few weeks the class WhatsApp groups will become announcement-only.",
].join(" ");
export const MOVE_NOTICE_BODY = flattenTemplateParam(MOVE_NOTICE_BODY_RAW);
export const MOVE_NOTICE_FITS = MOVE_NOTICE_BODY_RAW.length <= TEMPLATE_PARAM_MAX;
