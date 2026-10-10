/**
 * Where the school's WhatsApp number comes from, in order:
 *
 *   1. WHATSAPP_DISPLAY_NUMBER on the server — an explicit override;
 *   2. TENANT.whatsappNumber — blank today, by design (see lib/types.ts);
 *   3. Meta itself: the display number of the WHATSAPP_PHONE_ID the bot's
 *      webhook is bound to. This is the number the parent bot actually
 *      answers on, so it cannot drift from the truth. Cached in-process,
 *      because it changes about never and the summary is called often.
 *
 * Null when none of those yields a number — the app then shows no card.
 */
import { fetchWhatsAppPhoneHealth } from "@/lib/waMeta.server";
import {
  schoolWhatsAppContactFromDisplay,
  type SchoolWhatsAppContact,
} from "@/lib/schoolWhatsApp";
import { TENANT } from "@/lib/types";

const CACHE_OK_MS = 6 * 60 * 60 * 1000;
const CACHE_MISS_MS = 5 * 60 * 1000;

let cached: { value: SchoolWhatsAppContact | null; until: number } | null = null;

export async function schoolWhatsAppContact(): Promise<SchoolWhatsAppContact | null> {
  const fromEnv = schoolWhatsAppContactFromDisplay(process.env.WHATSAPP_DISPLAY_NUMBER);
  if (fromEnv) return fromEnv;
  const fromTenant = schoolWhatsAppContactFromDisplay(TENANT.whatsappNumber);
  if (fromTenant) return fromTenant;

  if (cached && cached.until > Date.now()) return cached.value;
  const health = await fetchWhatsAppPhoneHealth();
  const value = schoolWhatsAppContactFromDisplay(health.displayNumber);
  cached = { value, until: Date.now() + (value ? CACHE_OK_MS : CACHE_MISS_MS) };
  return value;
}

/** Tests and the setup screen: forget the Meta answer. */
export function resetSchoolWhatsAppCache(): void {
  cached = null;
}
