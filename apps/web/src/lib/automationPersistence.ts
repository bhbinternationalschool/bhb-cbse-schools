import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  automationIsEmpty,
  loadAutomation,
  writeAutomationLocalRaw,
  type AutomationState,
} from "@/lib/automation";

const desk = createDeskSlicePersistence<AutomationState>({
  moduleId: "automation",
  blobMetaKey: "bhb_automation_v1_remote_meta",
  label: "automation",
  isEmpty: automationIsEmpty,
  loadLocal: loadAutomation,
  writeLocalRaw: writeAutomationLocalRaw,
  hasRemoteData: (b) => (Array.isArray(b.rules) ? b.rules.length : 0) > 0,
});

export const scheduleAutomationSync = desk.scheduleSync;
export const ensureAutomationHydrated = desk.ensureHydrated;
export const resetAutomationPersistenceCache = desk.resetCache;
