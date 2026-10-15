/**
 * Seed the dues-callers bus rider into the local e2e stack
 * (apps/web/e2e/duesTransportCase.ts). Run by e2e/specs/dues-transport-desk.spec.ts,
 * from apps/web, with apps/web/.env.e2e already loaded by scripts/e2e/with-env.mjs.
 * Refuses anything but the 127.0.0.1 stack (assertLocalStack).
 */
import { seedDuesTransportCase } from "../apps/web/e2e/duesTransportCase";

seedDuesTransportCase().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
