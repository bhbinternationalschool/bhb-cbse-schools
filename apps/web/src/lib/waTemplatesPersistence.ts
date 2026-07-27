import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadWaTemplates,
  waTemplatesIsEmpty,
  writeWaTemplatesLocalRaw,
  type WaTemplatesState,
} from "@/lib/waTemplates";

const blob = createDomainBlobPersistence<WaTemplatesState>({
  table: "wa_templates_state",
  metaKey: "bhb_wa_templates_v1_remote_meta",
  label: "waTemplates",
  isEmpty: waTemplatesIsEmpty,
  loadLocal: loadWaTemplates,
  writeLocalRaw: writeWaTemplatesLocalRaw,
});

export const scheduleWaTemplatesSync = blob.scheduleSync;
export const ensureWaTemplatesHydrated = blob.ensureHydrated;
export const resetWaTemplatesPersistenceCache = blob.resetCache;
