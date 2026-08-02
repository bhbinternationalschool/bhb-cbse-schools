#!/usr/bin/env npx tsx
/**
 * Backfill admission_desk_* from admissions_state blob.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-admission-desk.ts
 */

import type { AdmissionsState } from "../src/lib/admissions";
import { normalizeAdmissionsState } from "../src/lib/admissions";
import {
  fetchAdmissionDeskFromDb,
  pushAdmissionDeskToDb,
} from "../src/lib/admissionsNormalized.server";

async function loadFromBlob(): Promise<AdmissionsState | null> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<AdmissionsState>("admissions_state");
  if (!blob.state) return null;
  return normalizeAdmissionsState(blob.state as Partial<AdmissionsState>);
}

async function main() {
  const state = await loadFromBlob();
  if (!state || (state.leads.length === 0 && state.households.length === 0)) {
    throw new Error(
      "No admissions data in admissions_state blob. Import leads in ERP first.",
    );
  }

  console.log("Loaded from admissions_state blob:", {
    households: state.households.length,
    leads: state.leads.length,
    registrationPayments: state.registrationPayments.length,
  });

  const before = await fetchAdmissionDeskFromDb();
  console.log(`DB before: ${before.state.leads.length} leads`);

  const result = await pushAdmissionDeskToDb(state);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchAdmissionDeskFromDb();
  console.log("Backfill OK");
  console.log(
    `DB after: ${after.state.leads.length} leads, ${after.state.households.length} households (${after.meta?.openLeadCount ?? 0} open)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
