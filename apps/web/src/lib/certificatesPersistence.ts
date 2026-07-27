import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  certificatesStateIsEmpty,
  loadCertificates,
  writeCertificatesLocalRaw,
  type CertificatesState,
} from "@/lib/certificates";

const blob = createDomainBlobPersistence<CertificatesState>({
  table: "certificates_state",
  metaKey: "bhb_certificates_v1_remote_meta",
  label: "certificates",
  isEmpty: certificatesStateIsEmpty,
  loadLocal: loadCertificates,
  writeLocalRaw: writeCertificatesLocalRaw,
});

export const scheduleCertificatesSync = blob.scheduleSync;
export const ensureCertificatesHydrated = blob.ensureHydrated;
export const resetCertificatesPersistenceCache = blob.resetCache;
