/**
 * Seed (`seed`) or take out again (`restore`) the TC / no-dues gate case in
 * the local e2e stack (apps/web/e2e/certificateDuesCase.ts). Run by
 * e2e/specs/certificates-dues-gate.spec.ts, from apps/web, with
 * apps/web/.env.e2e already loaded by scripts/e2e/with-env.mjs. Refuses
 * anything but the 127.0.0.1 stack (assertLocalStack).
 */
import { restoreCertificateDuesCase, seedCertificateDuesCase } from "../apps/web/e2e/certificateDuesCase";

const mode = process.argv[2];
const run = mode === "restore" ? restoreCertificateDuesCase : mode === "seed" ? seedCertificateDuesCase : null;
if (!run) {
  console.error("usage: e2e-seed-certificate-dues.ts seed|restore");
  process.exit(2);
}
run().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
