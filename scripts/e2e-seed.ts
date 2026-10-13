/**
 * Seed the local e2e stack (data-layer step 1.0). Run by
 * `bash scripts/e2e-stack.sh up`, from apps/web, with apps/web/.env.e2e loaded
 * by scripts/e2e/with-env.mjs:
 *
 *   cd apps/web && node ../../scripts/e2e/with-env.mjs .env.e2e -- npx --yes tsx ../../scripts/e2e-seed.ts
 *
 * The seed itself lives in apps/web/e2e/seed.ts so the app's typecheck and
 * lint cover it; the fixture is apps/web/e2e/fixture.ts. Both refuse any
 * Supabase URL that is not http://127.0.0.1:<port>.
 */
import { runSeed } from "../apps/web/e2e/seed";

runSeed().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
