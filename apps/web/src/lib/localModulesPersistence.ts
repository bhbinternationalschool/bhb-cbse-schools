/**
 * Server persistence for the modules that were localStorage-only until
 * 2026-08-18 — one adapter per module over createModuleStatePersistence
 * (module_local_state table, /api/school-data/module-state/<key>).
 *
 * "Empty" is judged generously on the LOCAL side: a browser holding only
 * defaults / no rows must never win over a configured server copy, and a
 * server copy is taken whenever it is at least as new as the local stamp.
 * Module files call scheduleModuleStateSync() from their save*() (dynamic
 * import, so this file may import them statically without a cycle).
 */

import {
  createModuleStatePersistence,
  type ModuleStatePersistence,
} from "@/lib/moduleStatePersistence";
import type { ModuleStateKey } from "@/lib/moduleStateRegistry";
import { loadHolds, writeHoldsLocalRaw } from "@/lib/holds";
import { loadFeeAdjustments, writeFeeAdjustmentsLocalRaw } from "@/lib/feeAdjustments";
import { loadIncrementState, writeIncrementStateLocalRaw } from "@/lib/salaryIncrement";
import { loadSalaryHold, writeSalaryHoldLocalRaw } from "@/lib/salaryHold";
import { loadSalaryAccount, writeSalaryAccountLocalRaw } from "@/lib/salaryAccount";
import { loadComplaints, writeComplaintsLocalRaw } from "@/lib/complaints";
import { loadDiscipline, writeDisciplineLocalRaw } from "@/lib/discipline";
import { loadHealth, writeHealthLocalRaw } from "@/lib/health";
import { loadVisitors, writeVisitorsLocalRaw } from "@/lib/visitors";
import { loadDutyRoster, writeDutyRosterLocalRaw } from "@/lib/dutyRoster";
import { loadInvigilation, writeInvigilationLocalRaw } from "@/lib/examInvigilation";
import { loadAttendanceRules, writeAttendanceRulesLocalRaw } from "@/lib/staffAttendanceRules";
import {
  loadUdiseComplianceSettings,
  writeUdiseComplianceSettingsLocalRaw,
} from "@/lib/udiseCompliance";
import { loadTallySync, writeTallySyncLocalRaw } from "@/lib/tallySync";
import { complianceFactsIsEmpty, loadComplianceFacts, writeComplianceFactsLocalRaw } from "@/lib/complianceFacts";
import { loadWaCampaigns, writeWaCampaignsLocalRaw } from "@/lib/waCampaigns";
import { admissionsKbIsEmpty, loadAdmissionsKb, writeAdmissionsKbLocalRaw } from "@/lib/admissionsKb";
import { loadSchoolAchievements, schoolAchievementsIsEmpty, writeSchoolAchievementsLocalRaw } from "@/lib/schoolAchievements";
import { loadCrmParentChat, writeCrmParentChatLocalRaw } from "@/lib/crmParentChat";
import { loadWaChatbotFlows, writeWaChatbotFlowsLocalRaw } from "@/lib/waChatbotFlows";
import { loadIdCardTemplateState, writeIdCardTemplateStateLocalRaw } from "@/lib/idCardTemplate";

type AnyState = Record<string, unknown>;

/** No array field with rows and no non-empty string besides version-ish keys. */
function noRows(state: unknown, arrays: string[]): boolean {
  const s = (state ?? {}) as AnyState;
  return arrays.every((k) => !Array.isArray(s[k]) || (s[k] as unknown[]).length === 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: Record<ModuleStateKey, ModuleStatePersistence<any>> = {
  fee_holds: createModuleStatePersistence({
    key: "fee_holds",
    isEmpty: (s) => noRows(s, ["overrides"]) && !(s as AnyState).principalPin,
    loadLocal: loadHolds,
    writeLocalRaw: writeHoldsLocalRaw,
  }),
  fee_adjustments: createModuleStatePersistence({
    key: "fee_adjustments",
    isEmpty: (s) => noRows(s, ["rows"]),
    loadLocal: () => ({ rows: loadFeeAdjustments() }),
    writeLocalRaw: writeFeeAdjustmentsLocalRaw,
  }),
  salary_increment: createModuleStatePersistence({
    key: "salary_increment",
    isEmpty: (s) => noRows(s, ["batches"]),
    loadLocal: loadIncrementState,
    writeLocalRaw: writeIncrementStateLocalRaw,
  }),
  salary_hold: createModuleStatePersistence({
    key: "salary_hold",
    isEmpty: (s) => noRows(s, ["holds", "settlements"]),
    loadLocal: loadSalaryHold,
    writeLocalRaw: writeSalaryHoldLocalRaw,
  }),
  salary_account: createModuleStatePersistence({
    key: "salary_account",
    isEmpty: (s) => noRows(s, ["entries"]),
    loadLocal: loadSalaryAccount,
    writeLocalRaw: writeSalaryAccountLocalRaw,
  }),
  complaints: createModuleStatePersistence({
    key: "complaints",
    isEmpty: (s) => noRows(s, ["tickets"]),
    loadLocal: loadComplaints,
    writeLocalRaw: writeComplaintsLocalRaw,
  }),
  discipline: createModuleStatePersistence({
    key: "discipline",
    isEmpty: (s) => noRows(s, ["incidents", "actions", "records", "cases"]),
    loadLocal: loadDiscipline,
    writeLocalRaw: writeDisciplineLocalRaw,
  }),
  health: createModuleStatePersistence({
    key: "health",
    isEmpty: (s) => noRows(s, ["visits", "records", "profiles", "incidents", "checkups"]),
    loadLocal: loadHealth,
    writeLocalRaw: writeHealthLocalRaw,
  }),
  visitors: createModuleStatePersistence({
    key: "visitors",
    isEmpty: (s) => noRows(s, ["visits", "passes", "entries", "visitors"]),
    loadLocal: loadVisitors,
    writeLocalRaw: writeVisitorsLocalRaw,
  }),
  duty_roster: createModuleStatePersistence({
    key: "duty_roster",
    isEmpty: (s) => noRows(s, ["assignments", "duties", "slots", "rosters"]),
    loadLocal: loadDutyRoster,
    writeLocalRaw: writeDutyRosterLocalRaw,
  }),
  exam_invigilation: createModuleStatePersistence({
    key: "exam_invigilation",
    isEmpty: (s) => noRows(s, ["assignments", "duties", "rooms", "plans"]),
    loadLocal: loadInvigilation,
    writeLocalRaw: writeInvigilationLocalRaw,
  }),
  staff_attendance_rules: createModuleStatePersistence({
    key: "staff_attendance_rules",
    isEmpty: (s) => noRows(s, ["assignments"]),
    loadLocal: loadAttendanceRules,
    writeLocalRaw: writeAttendanceRulesLocalRaw,
  }),
  udise_compliance: createModuleStatePersistence({
    key: "udise_compliance",
    // Settings object — treat "no server copy taken yet" as empty via the
    // meta stamp; a settings object always has defaults, so never "empty".
    isEmpty: () => true,
    loadLocal: () => ({ settings: loadUdiseComplianceSettings() }),
    writeLocalRaw: writeUdiseComplianceSettingsLocalRaw,
  }),
  compliance_facts: createModuleStatePersistence({
    key: "compliance_facts",
    isEmpty: complianceFactsIsEmpty,
    loadLocal: loadComplianceFacts,
    writeLocalRaw: writeComplianceFactsLocalRaw,
  }),
  admissions_kb: createModuleStatePersistence({
    key: "admissions_kb",
    isEmpty: admissionsKbIsEmpty,
    loadLocal: loadAdmissionsKb,
    writeLocalRaw: writeAdmissionsKbLocalRaw,
  }),
  school_achievements: createModuleStatePersistence({
    key: "school_achievements",
    isEmpty: schoolAchievementsIsEmpty,
    loadLocal: loadSchoolAchievements,
    writeLocalRaw: writeSchoolAchievementsLocalRaw,
  }),
  tally_sync: createModuleStatePersistence({
    key: "tally_sync",
    isEmpty: (s) => noRows(s, ["records"]),
    loadLocal: loadTallySync,
    writeLocalRaw: writeTallySyncLocalRaw,
  }),
  wa_campaigns: createModuleStatePersistence({
    key: "wa_campaigns",
    isEmpty: (s) => noRows(s, ["campaigns", "sends", "audiences", "lists"]),
    loadLocal: loadWaCampaigns,
    writeLocalRaw: writeWaCampaignsLocalRaw,
  }),
  crm_parent_chat: createModuleStatePersistence({
    key: "crm_parent_chat",
    isEmpty: (s) => noRows(s, ["threads", "messages", "conversations"]),
    loadLocal: loadCrmParentChat,
    writeLocalRaw: writeCrmParentChatLocalRaw,
  }),
  wa_chatbot_flows: createModuleStatePersistence({
    key: "wa_chatbot_flows",
    isEmpty: (s) => noRows(s, ["flows"]),
    loadLocal: loadWaChatbotFlows,
    writeLocalRaw: writeWaChatbotFlowsLocalRaw,
  }),
  id_card_template: createModuleStatePersistence({
    key: "id_card_template",
    isEmpty: (s) => noRows(s, ["templates", "designs"]),
    loadLocal: loadIdCardTemplateState,
    writeLocalRaw: writeIdCardTemplateStateLocalRaw,
  }),
};

export const MODULE_STATE_KEYS = Object.keys(registry) as ModuleStateKey[];

export function scheduleModuleStateSync(key: ModuleStateKey, state: unknown): void {
  registry[key].scheduleSync(state as object);
}

export async function ensureModuleStateHydrated(key: ModuleStateKey): Promise<boolean> {
  return registry[key].ensureHydrated();
}

export async function ensureModuleStatesHydrated(keys: ModuleStateKey[]): Promise<void> {
  await Promise.allSettled(keys.map((k) => registry[k].ensureHydrated()));
}

export async function ensureAllModuleStatesHydrated(): Promise<void> {
  await ensureModuleStatesHydrated(MODULE_STATE_KEYS);
}

export function resetModuleStatePersistenceCaches(): void {
  for (const k of MODULE_STATE_KEYS) registry[k].resetCache();
}
