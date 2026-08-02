#!/usr/bin/env npx tsx
/**
 * Seed vault_desk_* with default statutory documents (matches seedVaultIfEmpty).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-vault-desk.ts
 */

import {
  emptyVaultState,
  type VaultDocument,
  type VaultState,
} from "../src/lib/vault";
import {
  fetchVaultDeskFromDb,
  pushVaultDeskToDb,
} from "../src/lib/vaultNormalized.server";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const today = todayYmd();
  const y = Number(today.slice(0, 4));
  const now = new Date().toISOString();

  const documents: VaultDocument[] = [
    {
      id: "vdoc_seed_fire_noc",
      docType: "fire_noc",
      title: "Fire NOC — Main campus",
      fileUrl: "",
      fileName: "",
      issuedOn: `${y - 1}-04-01`,
      expiresOn: `${y}-03-31`,
      reminderDays: 45,
      ownerRole: "principal",
      note: "Renew before session start",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "vdoc_seed_building",
      docType: "building_safety",
      title: "Building safety certificate",
      fileUrl: "",
      fileName: "",
      issuedOn: `${y - 1}-06-15`,
      expiresOn: `${y + 1}-06-14`,
      reminderDays: 60,
      ownerRole: "admin",
      note: "",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "vdoc_seed_recognition",
      docType: "recognition",
      title: "UP Basic recognition",
      fileUrl: "",
      fileName: "",
      issuedOn: `${y - 2}-07-01`,
      expiresOn: "",
      reminderDays: 90,
      ownerRole: "principal",
      note: "No expiry — keep on file",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const state: VaultState = {
    ...emptyVaultState(),
    documents,
  };

  console.log(`Seeding ${documents.length} vault documents`);

  const before = await fetchVaultDeskFromDb();
  console.log(`DB before: ${before.bundle.documents.length} documents`);

  const result = await pushVaultDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchVaultDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.documents.length} documents (${after.meta?.expiringSoonCount ?? 0} expiring soon)`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
