/**
 * Server context for Gemini ERP assistant — role, modules, live desk snapshot.
 */

import type { DemoSession } from "@/lib/auth";
import {
  accessibleModuleLinks,
  type ErpAiChatContext,
  type ErpAiLink,
} from "@/lib/erpAiChat";
import { composeLeadershipWhatsAppReport } from "@/lib/waLeadershipReports.server";
import {
  canAccessModule,
  hasPermission,
  inferRoleCodes,
  loadRbac,
  resolveSessionRoles,
  type RbacModule,
} from "@/lib/rbac";
import { currentAcademicYearCode, loadMasters, type MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";

export function buildErpAiChatContext(
  session: DemoSession,
  masters: MastersState | null,
): ErpAiChatContext {
  return { session, masters };
}

function roleSummary(ctx: ErpAiChatContext): string {
  const rbac = loadRbac();
  const roles = resolveSessionRoles(rbac, ctx.session, ctx.masters);
  if (roles.length) {
    return roles.map((r) => r.name || r.code).join(", ");
  }
  const codes = inferRoleCodes(ctx.session, ctx.masters);
  return codes.join(", ") || ctx.session.roleCode || "staff";
}

function moduleAccessSummary(ctx: ErpAiChatContext): string {
  const links = accessibleModuleLinks(ctx);
  if (!links.length) return "Home only";
  return links.map((l) => `${l.label} (${l.href})`).join(", ");
}

function canSeeDeskStats(ctx: ErpAiChatContext): boolean {
  const modules: RbacModule[] = [
    "fees",
    "admissions",
    "attendance",
    "accounts",
    "home",
  ];
  return modules.some((m) => hasPermission(ctx.session, ctx.masters, m, "view"));
}

export function buildErpAiGeminiSystemPrompt(opts: {
  ctx: ErpAiChatContext;
  pathname?: string;
  tab?: string;
}): string {
  const { ctx, pathname, tab } = opts;
  const masters = ctx.masters || loadMasters();
  const ay = currentAcademicYearCode(masters);
  const modules = moduleAccessSummary(ctx);
  const desk =
    canSeeDeskStats(ctx) && ctx.session.persona === "staff"
      ? composeLeadershipWhatsAppReport()
      : "";

  const screen = [pathname || "/home", tab ? `tab=${tab}` : ""]
    .filter(Boolean)
    .join(" ");

  return [
    `You are the AI assistant for ${TENANT.nameDisplay} (${TENANT.city}, ${TENANT.state}) school ERP.`,
    `User: ${ctx.session.fullName || "Staff"} · roles: ${roleSummary(ctx)} · persona: ${ctx.session.persona}.`,
    `Academic session in header: ${ay || "current"}.`,
    `Current screen: ${screen}.`,
    "",
    "RULES:",
    "- Answer in the same language the user uses (English or Hindi).",
    "- Be concise (under 12 lines unless they ask for detail). Use **bold** for module names and key steps.",
    "- Only mention ERP modules the user can access (listed below). Never invent student names, amounts, or private data.",
    "- For navigation, suggest exact paths like /fees, /admissions, /timetable?tab=subs.",
    "- If you lack live data, say what to open in ERP (e.g. Fee Take, Admissions CRM) instead of guessing.",
    "- Do not claim to have changed data — you only guide; staff must save in the UI.",
    "- WhatsApp school number is +91 94519 38805; parents message for bot menus.",
    "",
    `Modules this user can open: ${modules}.`,
    desk
      ? `\nLIVE DESK SNAPSHOT (aggregates only — use for summary questions):\n${desk}`
      : "\n(User does not have leadership desk stats — avoid inventing numbers.)",
  ].join("\n");
}

/** Suggest ERP links from Gemini text + user-accessible modules. */
export function inferLinksFromGeminiText(
  text: string,
  ctx: ErpAiChatContext,
): ErpAiLink[] {
  const allowed = accessibleModuleLinks(ctx);
  const low = text.toLowerCase();
  const hits: ErpAiLink[] = [];
  for (const link of allowed) {
    const pathKey = link.href.split("?")[0]!.replace(/^\//, "");
    if (
      low.includes(link.href) ||
      low.includes(pathKey) ||
      low.includes(link.label.toLowerCase())
    ) {
      if (!hits.some((h) => h.href === link.href)) hits.push(link);
    }
  }
  return hits.slice(0, 3);
}
