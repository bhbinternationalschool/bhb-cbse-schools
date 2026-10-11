import { PARENT_APP_URL } from "@/lib/classGroupMoveNotice";
import { flattenTemplateParam, TEMPLATE_PARAM_MAX } from "@/lib/classNoticeWa";
import { isPlaceholderMobile } from "@/lib/sis";

/**
 * "Please install the parent app" — sent from Comms → Parents on app to the
 * families who have never signed in.
 *
 * There is no Meta template of its own for this: it goes inside the school's
 * approved "School notice" template (comms_notice, Hindi and English both
 * approved), which picks each family's language — Hindi unless the family
 * chose English. The template's title/body are one parameter each for every
 * recipient, so the text is Hindi first, then English, the Play link once
 * (the same shape as the class-group move notice). Template params take no
 * newlines and at most TEMPLATE_PARAM_MAX characters; the selftest fails a
 * draft that would be cut off.
 *
 * Sign-in is by OTP on the family's number registered at school; a family
 * whose number changed is asked to tell the school here (the in-app
 * number link, lib/parentNumberLink, needs an app build parents may not
 * have yet, so it is not promised).
 */
export const APP_INVITE_TITLE = "BHB parent app / BHB अभिभावक ऐप";
export const APP_INVITE_BODY_RAW = [
  "प्रिय अभिभावक, अपने बच्चे की उपस्थिति, गृहकार्य, सूचनाएँ, फीस और रसीदें अब BHB International School ऐप में देखें — ऐप मुफ़्त है।",
  "ऐप डाउनलोड करें और स्कूल में दर्ज अपने मोबाइल नंबर से OTP द्वारा लॉग इन करें। नंबर बदल गया हो तो इसी नंबर पर स्कूल को बताएँ।",
  "| Dear parent, see your child's attendance, homework, notices, fees and receipts in the free BHB International School app.",
  "Sign in with the mobile number registered at school (OTP); if your number has changed, tell the school on this WhatsApp number. Download the app:",
  PARENT_APP_URL,
].join(" ");
export const APP_INVITE_BODY = flattenTemplateParam(APP_INVITE_BODY_RAW);
export const APP_INVITE_FITS = APP_INVITE_BODY_RAW.length <= TEMPLATE_PARAM_MAX;
export const APP_INVITE_TEMPLATE_FAMILY = "comms_notice";

/**
 * The numbers an invite may go to: a placeholder (0000000000, 9999999999 …)
 * is never one, matching what the report shows as "no phone". A placeholder
 * primary gives way to a real fallback; with neither, null (skip the family).
 */
export function realInviteNumbers(r: { mobile: string; fallbackMobile?: string }): { mobile: string; fallbackMobile?: string } | null {
  const real = (m?: string) => !!m && !isPlaceholderMobile(m);
  const nums = [r.mobile, r.fallbackMobile].filter(real) as string[];
  if (!nums.length) return null;
  return nums[1] ? { mobile: nums[0]!, fallbackMobile: nums[1] } : { mobile: nums[0]! };
}

/** Send-once key: one invite per family per India day, across presses and tabs. */
export const appInviteClaimKey = (householdId: string, istDayIso: string) => `app_invite:${householdId}:${istDayIso}`;
