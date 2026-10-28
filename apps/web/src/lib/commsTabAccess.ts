import type { MastersState } from "@/lib/masters";
import { featureGrantHeld, type RbacModule, type RbacState, type SessionLike } from "@/lib/rbac";
import { featuresForTab } from "@/lib/rbacFeatures";

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

/** Every module whose functions open a Comms tab (the screen's tab modules). */
const COMMS_MODULES: RbacModule[] = [
  "notices",
  "news",
  "gallery",
  "notifications",
  "wa_automation",
  "wa_chatbot",
];

/**
 * Does this person hold, as a FUNCTION grant, a Comms function that lists
 * `tab`? The module grant does not count here: a teacher's notices · view
 * reads notices, and must not open an office tab by itself.
 */
export function commsTabOpenedByFunction(
  session: SessionLike,
  masters: MastersState | null | undefined,
  tab: string,
  rbac?: RbacState,
): boolean {
  return COMMS_MODULES.some((m) =>
    featuresForTab(m, tab).some((f) =>
      f.actions.some((a) => featureGrantHeld(session, masters, f.id, a, rbac)),
    ),
  );
}
