import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  loadWaTemplates,
  waTemplatesIsEmpty,
  writeWaTemplatesLocalRaw,
  type WaTemplatesState,
} from "@/lib/waTemplates";

const desk = createDeskSlicePersistence<WaTemplatesState>({
  moduleId: "wa_templates",
  blobMetaKey: "bhb_wa_templates_v1_remote_meta",
  label: "waTemplates",
  isEmpty: waTemplatesIsEmpty,
  loadLocal: loadWaTemplates,
  writeLocalRaw: writeWaTemplatesLocalRaw,
  hasRemoteData: (b) =>
    (Array.isArray(b.templates) ? b.templates.length : 0) > 0,
});

export const scheduleWaTemplatesSync = desk.scheduleSync;
export const ensureWaTemplatesHydrated = desk.ensureHydrated;
export const resetWaTemplatesPersistenceCache = desk.resetCache;
