import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  certificatesStateIsEmpty,
  loadCertificates,
  writeCertificatesLocalRaw,
  type CertificatesState,
} from "@/lib/certificates";

const desk = createDeskSlicePersistence<CertificatesState>({
  moduleId: "certificates",
  blobMetaKey: "bhb_certificates_v1_remote_meta",
  label: "certificates",
  isEmpty: certificatesStateIsEmpty,
  loadLocal: loadCertificates,
  writeLocalRaw: writeCertificatesLocalRaw,
  hasRemoteData: (b) => (Array.isArray(b.issues) ? b.issues.length : 0) > 0,
});

export const scheduleCertificatesSync = desk.scheduleSync;
export const ensureCertificatesHydrated = desk.ensureHydrated;
export const resetCertificatesPersistenceCache = desk.resetCache;
