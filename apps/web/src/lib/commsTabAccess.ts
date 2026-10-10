/**
 * Which Comms tabs are office work. Teachers hold notices · view — enough
 * to READ notices, news, the gallery and their inbox — and until 10 Oct
 * 2026 that same grant showed them every Comms tab: every family's WhatsApp
 * chat, App pop-ups, and Parents on app with every parent's mobile number.
 * These tabs need notices · edit (principal, office, admin). Pure.
 */

export const OFFICE_ONLY_COMMS_TABS = new Set([
  "dashboard",
  "whatsapp",
  "email",
  "social",
  "answers",
  "popups",
  "onapp",
  "reports",
]);

/** The Comms tab an href opens, or null for a non-Comms href. */
export function commsTabOfHref(href: string): string | null {
  const [path, query = ""] = href.split("?");
  if (path !== "/comms") return null;
  return new URLSearchParams(query).get("tab") || "notices";
}

export function commsTabIsOfficeOnly(tab: string | null): boolean {
  return !!tab && OFFICE_ONLY_COMMS_TABS.has(tab);
}
