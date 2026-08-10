/**
 * When the server tenant wipe signal is newer than last seen, drop stale browser desks.
 */

const SEEN_KEY = "bhb_tenant_data_wipe_seen_v1";

const DESK_PREFIX = "bhb_";

/**
 * A wipe signal expires.
 *
 * The "seen" marker lives in localStorage, so a client with empty storage has
 * never seen anything and applies the signal on first load — forever. That is
 * not hypothetical: the 2026-08-05 signal was still firing on 2026-08-10,
 * emptying masters on every cold client and stamping a five-day-old revision
 * as its push base. Worse, clearing site data DELETES the marker, so clearing
 * re-triggered the wipe — which is why "clear your browser" made devices
 * worse rather than better.
 *
 * A signal is an instruction to drop desks that predate a re-seed. A browser
 * that first loaded a week later has nothing of the sort to drop, so age is
 * the right bound: past this, assume affected devices have drained.
 */
const MAX_WIPE_SIGNAL_AGE_DAYS = 7;

type WipeSignal = {
  wipedAt: string;
  note?: string;
};

let wipeCheckDone = false;

export async function applyTenantDataWipeSignalIfNeeded(): Promise<boolean> {
  if (typeof window === "undefined" || wipeCheckDone) return false;
  wipeCheckDone = true;

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

  // Expired signals are ignored — see MAX_WIPE_SIGNAL_AGE_DAYS. An
  // unparseable timestamp is treated as expired rather than as "now":
  // guessing here means wiping a browser on the strength of a malformed
  // file, and the failure mode of ignoring it is merely that a stale desk
  // survives one more reload.
  const wipedMs = Date.parse(signal.wipedAt);
  const ageDays = Number.isFinite(wipedMs)
    ? (Date.now() - wipedMs) / 86_400_000
    : Number.POSITIVE_INFINITY;
  if (ageDays > MAX_WIPE_SIGNAL_AGE_DAYS) {
    console.warn(
      `[tenant-wipe] ignoring signal from ${signal.wipedAt} — ` +
        `${Math.floor(ageDays)} days old, past the ${MAX_WIPE_SIGNAL_AGE_DAYS}-day limit. ` +
        "Retire it in public/tenant_data_wiped.json.",
    );
    // Recorded as seen so the warning does not repeat every load.
    localStorage.setItem(SEEN_KEY, signal.wipedAt);
    return false;
  }

  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(DESK_PREFIX)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);

  localStorage.removeItem("bhb_masters_desk_db_meta_v1");
  localStorage.removeItem("bhb_masters_mirror_meta_v1");

  const { emptyMastersShell } = await import("@/lib/masters");
  const emptyShell = emptyMastersShell();
  localStorage.setItem("bhb_masters_v5", JSON.stringify(emptyShell));

  localStorage.setItem(
    "bhb_masters_mirror_meta_v1",
    JSON.stringify({ updatedAt: signal.wipedAt }),
  );
  const { touchMastersDeskLocalMeta } = await import(
    "@/lib/mastersNormalizedClient"
  );
  touchMastersDeskLocalMeta(emptyShell, signal.wipedAt);

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
