/**
 * Registry for secondary desk-slice modules (jsonb blob → normalized slices).
 */

import type { DomainBlobTable } from "@/lib/domainBlobPersistence";
import type { DeskModuleId } from "@/lib/deskCutover";
import { deskPublicEnv } from "@/lib/deskPublicEnv";

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
  /**
   * Slices a save MERGES into what is stored instead of replacing: the
   * pushed rows win for their ids and every stored row the push lacks is
   * kept. For lists something other than this browser also writes (the
   * server, the staff app, the bot) and the UI never deletes from, and for
   * append-only logs. A replaced slice is the browser's copy, verbatim — a
   * stale browser's copy included.
   */
  mergeSlices?: string[];
  /** Newest-N cap kept after a merge, for logs the client also trims. */
  mergeCaps?: Record<string, { max: number; newestBy: string }>;
  /** Merge slices whose rows are keyed by a field other than `id`. */
  mergeKeys?: Record<string, string>;
  /**
   * Merge slices the UI deletes rows from. The browser names those
   * deletions — rows it knew from the server and has since dropped (see
   * deskSliceNormalizedClient) — and only those are deleted. Everything
   * else a save lacks is kept.
   */
  clientDeleteSlices?: string[];
};

export const DESK_SLICE_MODULE_DEFS: DeskSliceModuleDef[] = [
  {
    id: "rbac",
    label: "RBAC",
    envPrefix: "RBAC",
    deskPrefix: "rbac",
    blobTable: "rbac_state",
    sliceKeys: ["roles", "assignments", "audit", "userGrants"],
    objectSlices: ["mobile"],
    signalSlice: "roles",
    // Roles, assignments and per-user grants are deleted in the UI (named,
    // not inferred); the audit is append-only, newest 200 kept.
    mergeSlices: ["roles", "assignments", "userGrants", "audit"],
    mergeCaps: { audit: { max: 200, newestBy: "at" } },
    clientDeleteSlices: ["roles", "assignments", "userGrants"],
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
    // bank + blueprints added 2026-08-19 — same slice table, new slice_key rows.
    sliceKeys: ["papers", "bank", "blueprints"],
    // What the school taught the paper importer about its publisher's words.
    objectSlices: ["importMappings"],
    signalSlice: "papers",
    // Papers, banked questions and blueprints are deleted in the UI — named.
    mergeSlices: ["papers", "bank", "blueprints"],
    clientDeleteSlices: ["papers", "bank", "blueprints"],
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
    // The UI never deletes a template; replacing let a stale tab drop new ones.
    mergeSlices: ["templates"],
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
      "leaveAllotmentLog",
      "appraisalCycles",
      "appraisals",
    ],
    objectSlices: ["leaveSettings"],
    signalSlice: "leaveTypes",
    // Written by the staff app and the WhatsApp leave command as well as the
    // office. Leave requests are applied and decided from the phone and on
    // WhatsApp, and never deleted in the UI; the one server path that removes
    // a request (withdraw) names it.
    mergeSlices: [
      "leaveRequests",
      "leaveEncashments",
      "leaveAllotmentLog",
      "appraisalCycles",
      "appraisals",
      "leaveTypes",
      "leaveBalances",
    ],
    // Leave types are keyed by code. Types and balances are deleted in the UI
    // (removing a type drops its balances) — named.
    mergeKeys: { leaveTypes: "code" },
    clientDeleteSlices: ["leaveTypes", "leaveBalances"],
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
    // Voiding an advance removes it — named.
    mergeSlices: ["advances"],
    clientDeleteSlices: ["advances"],
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
    // The staff app logs follow-ups on the server; the desk never deletes
    // one. The server replaces a family's open follow-up by naming it, and
    // keeps the newest 2,000.
    mergeSlices: ["meetings"],
    mergeCaps: { meetings: { max: 2000, newestBy: "createdAt" } },
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
    // The scheduler tick and the approve route write these on the server,
    // from a copy that can be stale; nothing deletes a rule, an approval or a
    // run — the logs are only trimmed to their newest N, kept after a merge.
    mergeSlices: ["rules", "approvals", "runs"],
    mergeCaps: {
      approvals: { max: 500, newestBy: "createdAt" },
      runs: { max: 200, newestBy: "startedAt" },
    },
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
    // Every staff browser saves the chat; a thread or message is never
    // deleted, so one device's save must not drop another's messages.
    mergeSlices: ["threads", "messages"],
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
    mergeSlices: ["threads", "messages"],
  },
];

const defById = new Map(DESK_SLICE_MODULE_DEFS.map((d) => [d.id, d]));

export function deskSliceDef(id: DeskModuleId): DeskSliceModuleDef | undefined {
  return defById.get(id);
}

export function deskSliceEnvDualWrite(prefix: string): boolean {
  // Browser: static NEXT_PUBLIC map (deskPublicEnv.ts) — a dynamic
  // process.env[...] read here was always undefined in the client.
  const flag = (
    typeof window !== "undefined"
      ? deskPublicEnv(`NEXT_PUBLIC_${prefix}_DUAL_WRITE_DB`)
      : process.env[`${prefix}_DUAL_WRITE_DB`]
  )
    ?.trim()
    .toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function deskSliceEnvReadFromDb(prefix: string): boolean {
  const flag = (
    typeof window !== "undefined"
      ? deskPublicEnv(`NEXT_PUBLIC_${prefix}_READ_FROM_DB`)
      : process.env[`${prefix}_READ_FROM_DB`]
  )
    ?.trim()
    .toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}
