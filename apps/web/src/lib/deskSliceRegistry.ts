/**
 * Registry for secondary desk-slice modules (jsonb blob → normalized slices).
 */

import type { DomainBlobTable } from "@/lib/domainBlobPersistence";
import type { DeskModuleId } from "@/lib/deskCutover";

export type DeskSliceModuleDef = {
  id: DeskModuleId;
  label: string;
  envPrefix: string;
  deskPrefix: string;
  blobTable: DomainBlobTable;
  sliceKeys: string[];
  objectSlices: string[];
  /** Primary array slice used to detect remote data on hydrate */
  signalSlice: string;
};

export const DESK_SLICE_MODULE_DEFS: DeskSliceModuleDef[] = [
  {
    id: "rbac",
    label: "RBAC",
    envPrefix: "RBAC",
    deskPrefix: "rbac",
    blobTable: "rbac_state",
    sliceKeys: ["roles", "assignments", "audit"],
    objectSlices: [],
    signalSlice: "roles",
  },
  {
    id: "certificates",
    label: "Certificates",
    envPrefix: "CERTIFICATES",
    deskPrefix: "certificates",
    blobTable: "certificates_state",
    sliceKeys: ["issues"],
    objectSlices: [],
    signalSlice: "issues",
  },
  {
    id: "exam_papers",
    label: "Exam papers",
    envPrefix: "EXAM_PAPERS",
    deskPrefix: "exam_papers",
    blobTable: "exam_papers_state",
    sliceKeys: ["papers"],
    objectSlices: [],
    signalSlice: "papers",
  },
  {
    id: "wa_templates",
    label: "WA templates",
    envPrefix: "WA_TEMPLATES",
    deskPrefix: "wa_templates",
    blobTable: "wa_templates_state",
    sliceKeys: ["templates", "audit"],
    objectSlices: ["lastMetaSyncAt"],
    signalSlice: "templates",
  },
  {
    id: "staff_hr",
    label: "Staff HR",
    envPrefix: "STAFF_HR",
    deskPrefix: "staff_hr",
    blobTable: "staff_hr_state",
    sliceKeys: [
      "leaveTypes",
      "leaveRequests",
      "leaveBalances",
      "leaveEncashments",
      "appraisalCycles",
      "appraisals",
    ],
    objectSlices: ["leaveSettings"],
    signalSlice: "leaveTypes",
  },
  {
    id: "staff_advances",
    label: "Staff advances",
    envPrefix: "STAFF_ADVANCES",
    deskPrefix: "staff_advances",
    blobTable: "staff_advances_state",
    sliceKeys: ["advances"],
    objectSlices: [],
    signalSlice: "advances",
  },
  {
    id: "staff_agreements",
    label: "Staff agreements",
    envPrefix: "STAFF_AGREEMENTS",
    deskPrefix: "staff_agreements",
    blobTable: "staff_agreements_state",
    sliceKeys: ["agreements"],
    objectSlices: [],
    signalSlice: "agreements",
  },
  {
    id: "module_registry",
    label: "Module registry",
    envPrefix: "MODULE_REGISTRY",
    deskPrefix: "module_registry",
    blobTable: "module_registry_state",
    sliceKeys: [],
    objectSlices: ["enabled"],
    signalSlice: "enabled",
  },
  {
    id: "fee_recovery_tasks",
    label: "Fee recovery tasks",
    envPrefix: "FEE_RECOVERY_TASKS",
    deskPrefix: "fee_recovery_tasks",
    blobTable: "fee_recovery_tasks_state",
    sliceKeys: ["meetings"],
    objectSlices: [],
    signalSlice: "meetings",
  },
  {
    id: "automation",
    label: "Automation",
    envPrefix: "AUTOMATION",
    deskPrefix: "automation",
    blobTable: "automation_state",
    sliceKeys: ["rules", "approvals", "runs"],
    objectSlices: ["lastTickAt"],
    signalSlice: "rules",
  },
  {
    id: "erp_chat",
    label: "ERP chat",
    envPrefix: "ERP_CHAT",
    deskPrefix: "erp_chat",
    blobTable: "erp_chat_state",
    sliceKeys: ["threads", "messages"],
    objectSlices: [],
    signalSlice: "threads",
  },
  {
    id: "staff_chat",
    label: "Staff chat",
    envPrefix: "STAFF_CHAT",
    deskPrefix: "staff_chat",
    blobTable: "staff_chat_state",
    sliceKeys: ["threads", "messages"],
    objectSlices: [],
    signalSlice: "threads",
  },
];

const defById = new Map(DESK_SLICE_MODULE_DEFS.map((d) => [d.id, d]));

export function deskSliceDef(id: DeskModuleId): DeskSliceModuleDef | undefined {
  return defById.get(id);
}

export function deskSliceEnvDualWrite(prefix: string): boolean {
  const flag =
    (typeof window !== "undefined"
      ? process.env[`NEXT_PUBLIC_${prefix}_DUAL_WRITE_DB`]
      : process.env[`${prefix}_DUAL_WRITE_DB`])?.trim().toLowerCase() ||
    process.env[`${prefix}_DUAL_WRITE_DB`]?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function deskSliceEnvReadFromDb(prefix: string): boolean {
  if (typeof window !== "undefined") {
    return process.env[`NEXT_PUBLIC_${prefix}_READ_FROM_DB`] === "true";
  }
  return process.env[`${prefix}_READ_FROM_DB`] === "true";
}
