import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  automationIsEmpty,
  loadAutomation,
  writeAutomationLocalRaw,
  type AutomationState,
} from "@/lib/automation";

const blob = createDomainBlobPersistence<AutomationState>({
  table: "automation_state",
  metaKey: "bhb_automation_v1_remote_meta",
  label: "automation",
  isEmpty: automationIsEmpty,
  loadLocal: loadAutomation,
  writeLocalRaw: writeAutomationLocalRaw,
});

export const scheduleAutomationSync = blob.scheduleSync;
export const ensureAutomationHydrated = blob.ensureHydrated;
export const resetAutomationPersistenceCache = blob.resetCache;
