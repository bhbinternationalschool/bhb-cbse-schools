/**
 * Modules persisted through the generic module_local_state store — the
 * modules that were still localStorage-only on 2026-08-18. Shared by the
 * API route (RBAC) and the client factory (endpoint + labels). Adding a
 * module = one line here + wiring its save/load in lib/moduleStatePersistence.
 */

import type { RbacModule } from "@/lib/rbac";

export type ModuleStateKey =
  | "fee_holds"
  | "fee_adjustments"
  | "salary_increment"
  | "salary_hold"
  | "salary_account"
  | "complaints"
  | "discipline"
  | "health"
  | "visitors"
  | "duty_roster"
  | "exam_invigilation"
  | "staff_attendance_rules"
  | "udise_compliance"
  | "tally_sync"
  | "wa_campaigns"
  | "crm_parent_chat"
  | "wa_chatbot_flows"
  | "id_card_template";

export const MODULE_STATE_DEFS: Record<
  ModuleStateKey,
  { rbac: RbacModule; label: string }
> = {
  fee_holds: { rbac: "fees", label: "fee holds" },
  fee_adjustments: { rbac: "fees", label: "fee adjustments" },
  salary_increment: { rbac: "payroll", label: "salary increments" },
  salary_hold: { rbac: "payroll", label: "salary holds" },
  salary_account: { rbac: "payroll", label: "salary account" },
  complaints: { rbac: "complaints", label: "complaints" },
  discipline: { rbac: "discipline", label: "discipline" },
  health: { rbac: "health", label: "health records" },
  visitors: { rbac: "visitors", label: "visitor register" },
  duty_roster: { rbac: "staff", label: "duty roster" },
  exam_invigilation: { rbac: "exams", label: "exam invigilation" },
  staff_attendance_rules: { rbac: "attendance", label: "staff attendance rules" },
  udise_compliance: { rbac: "compliance", label: "UDISE compliance" },
  tally_sync: { rbac: "accounts", label: "Tally sync" },
  wa_campaigns: { rbac: "admissions", label: "WhatsApp campaigns" },
  crm_parent_chat: { rbac: "admissions", label: "parent chat" },
  wa_chatbot_flows: { rbac: "wa_chatbot", label: "WhatsApp chatbot flows" },
  id_card_template: { rbac: "id_cards", label: "ID card templates" },
};

export function isModuleStateKey(raw: string): raw is ModuleStateKey {
  return Object.prototype.hasOwnProperty.call(MODULE_STATE_DEFS, raw);
}
