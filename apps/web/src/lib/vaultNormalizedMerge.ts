import type { VaultState } from "@/lib/vault";
import { vaultReadFromDbEnabled } from "@/lib/vaultDbConfig";
import type { VaultDeskBundle } from "@/lib/vaultNormalized.server";

export function mergeDbDeskIntoVaultState(
  state: VaultState,
  bundle: VaultDeskBundle,
  opts?: { preferDb?: boolean },
): VaultState {
  const hasRemote =
    bundle.documents.length > 0 || !!bundle.settings.digestMobiles;
  if (!hasRemote && !vaultReadFromDbEnabled() && !opts?.preferDb) return state;

  const preferDb = !!opts?.preferDb || vaultReadFromDbEnabled();
  const takeDocs =
    preferDb ||
    (state.documents?.length ?? 0) === 0 ||
    bundle.documents.length >= (state.documents?.length ?? 0);

  const byId = new Map<string, VaultState["documents"][0]>();
  if (!takeDocs) {
    for (const d of state.documents ?? []) byId.set(d.id, d);
  }
  for (const d of bundle.documents) byId.set(d.id, d);
  if (!takeDocs) {
    for (const d of state.documents ?? []) {
      if (!byId.has(d.id)) byId.set(d.id, d);
    }
  }

  return {
    ...state,
    version: 1,
    documents: [...byId.values()],
    settings: bundle.settings ?? state.settings,
  };
}
