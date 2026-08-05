/**
 * When the server tenant wipe signal is newer than last seen, drop stale browser desks.
 */

const SEEN_KEY = "bhb_tenant_data_wipe_seen_v1";

const DESK_PREFIX = "bhb_";

type WipeSignal = {
  wipedAt: string;
  note?: string;
};

export async function applyTenantDataWipeSignalIfNeeded(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  let signal: WipeSignal;
  try {
    const res = await fetch("/tenant_data_wiped.json", { cache: "no-store" });
    if (!res.ok) return false;
    signal = (await res.json()) as WipeSignal;
  } catch {
    return false;
  }

  if (!signal?.wipedAt) return false;
  if (localStorage.getItem(SEEN_KEY) === signal.wipedAt) return false;

  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(DESK_PREFIX)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);

  localStorage.removeItem("bhb_masters_desk_db_meta_v1");
  localStorage.removeItem("bhb_masters_mirror_meta_v1");

  const { emptyMastersShell } = await import("@/lib/masters");
  localStorage.setItem("bhb_masters_v5", JSON.stringify(emptyMastersShell()));

  localStorage.setItem(SEEN_KEY, signal.wipedAt);

  const resets = [
    import("@/lib/sisPersistence").then((m) => m.resetSisPersistenceCache()),
    import("@/lib/admissionsPersistence").then((m) =>
      m.resetAdmissionsPersistenceCache(),
    ),
    import("@/lib/staffPersistence").then((m) => m.resetStaffPersistenceCache()),
    import("@/lib/feesPersistence").then((m) => m.resetFeesPersistenceCache?.()),
    import("@/lib/mastersPersistence").then((m) => {
      const reset = (m as { resetMastersPersistenceCache?: () => void })
        .resetMastersPersistenceCache;
      reset?.();
    }),
  ];
  await Promise.allSettled(resets);

  return keys.length > 0;
}
