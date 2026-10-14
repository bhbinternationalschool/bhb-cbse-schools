/**
 * Which browser keys a login may wipe (14 Oct 2026).
 *
 * Every login clears the desk copies under "bhb_" so a new user never sees
 * the last user's data. That wipe also took the keys that say what THIS
 * DEVICE is — the office tablet's QR-screen key went at every re-login after
 * the 30-minute idle logout, so "Open QR screen on this device" made a new
 * "Office tablet" twice a day (~20 rows, 8–14 Oct). Keys here describe the
 * device or hold unsent work, not anybody's desk, and survive a login.
 */

/** This device's office QR-screen key — PunchPhonesPanel reuses it rather than make a new screen. */
export const PUNCH_SCREEN_TOKEN_KEY = "bhb_punch_screen_token";

const KEEP_ON_LOGIN = new Set<string>([
  "bhb_tenant_data_wipe_seen_v1",
  // Deletions the server has not confirmed yet must survive a re-login,
  // or the removed student comes back on the next hydrate.
  "bhb_sis_pending_deletes_v1",
  // ── this device ──
  PUNCH_SCREEN_TOKEN_KEY,
  "bhb_survey_agent_member_v1", // which surveyor this phone belongs to
  "bhb_survey_offline_v1", // survey pings not yet sent
  "bhb_visitor_lang", // gate kiosk language
  "bhb_visitor_desk_lang",
  "bhb_gate_wa_number", // gate QR's WhatsApp number on this device
  "bhb_login_app_card_dismissed_v2",
  "bhb_chat_alert_prefs_v1", // sound / alert choice on this device
]);

const KEEP_PREFIXES_ON_LOGIN = ["bhb_pwa_dismiss_"];

const DESK_PREFIX = "bhb_";

/** True when a login's clean-up removes this localStorage key. */
export function clearedOnLogin(key: string): boolean {
  if (!key.startsWith(DESK_PREFIX)) return false;
  if (KEEP_ON_LOGIN.has(key)) return false;
  return !KEEP_PREFIXES_ON_LOGIN.some((p) => key.startsWith(p));
}
