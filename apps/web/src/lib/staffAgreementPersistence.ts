import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  agreementsStateIsEmpty,
  loadAgreements,
  writeAgreementsLocalRaw,
  type AgreementState,
} from "@/lib/staffAgreement";

const desk = createDeskSlicePersistence<AgreementState>({
  moduleId: "staff_agreements",
  blobMetaKey: "bhb_staff_agreements_v1_remote_meta",
  label: "staffAgreements",
  isEmpty: agreementsStateIsEmpty,
  loadLocal: loadAgreements,
  writeLocalRaw: writeAgreementsLocalRaw,
  hasRemoteData: (b) =>
    (Array.isArray(b.agreements) ? b.agreements.length : 0) > 0,
});

export const staffAgreementsRemoteEnabled = desk.remoteEnabled;
export const scheduleStaffAgreementsSync = desk.scheduleSync;
export const ensureStaffAgreementsHydrated = desk.ensureHydrated;
export const resetStaffAgreementsPersistenceCache = desk.resetCache;
