/**
 * Seed the 15 Oct 2026 transport paid-month case into the local e2e stack
 * (apps/web/e2e/transportPaidCase.ts) — TPM_CASE=parent seeds the parent case.
 * Run by e2e/specs/transport-paid-month.spec.ts and the other transport-case specs,
 * from apps/web, with apps/web/.env.e2e already loaded by scripts/e2e/with-env.mjs.
 * Refuses anything but the 127.0.0.1 stack (assertLocalStack).
 */
import { seedTransportPaidCase } from "../apps/web/e2e/transportPaidCase";

seedTransportPaidCase().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
