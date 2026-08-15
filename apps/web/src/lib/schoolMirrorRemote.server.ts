/**
 * Hydrate server school mirror from Supabase (SIS tables + domain blobs).
 * Required on Cloud Run where localStorage / .data are empty.
 * Read-only toward Supabase — never write empty slices back on hydrate.
 */

import {
  getSchoolMirrorSync,
  replaceSchoolMirror,
  type SchoolMirrorBundle,
} from "@/lib/schoolDataMirror";
import { fetchServerBlob } from "@/lib/serverBlob";
import { defaultAdmissionsState, type AdmissionsState, admissionsStateIsEmpty } from "@/lib/admissions";
import { fetchAdmissionsRemoteServer } from "@/lib/admissionsPersistence";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import { emptyFeesState, type FeesState } from "@/lib/fees";
import { emptyPaymentsState, type PaymentsState } from "@/lib/payments";
import { emptySisState, type SisState } from "@/lib/sis";
import {
  fetchStaffRemoteServer,
  mergeStaffRemoteIntoMasters,
} from "@/lib/staffPersistence";
import { mergeDeskMastersOverBlob } from "@/lib/mastersMergePolicy";

let lastHydrateMs = 0;
let inFlightPromise: Promise<boolean> | null = null;
const HYDRATE_TTL_MS = 45_000;

function nowIso() {
  return new Date().toISOString();
}

function admissionsLeadCount(adm: AdmissionsState | null | undefined): number {
  return Array.isArray(adm?.leads) ? adm.leads.length : 0;
}

function mirrorLooksEmpty(bundle: SchoolMirrorBundle): boolean {
  const sis = bundle.sis as SisState | null;
  const masters = bundle.masters as MastersState | null;
  const admissions = bundle.admissions as AdmissionsState | null;
  const hasSis =
    !!sis &&
    ((sis.households?.length ?? 0) > 0 || (sis.students?.length ?? 0) > 0);
  const hasStaff = (masters?.staff?.length ?? 0) > 0;
  const hasClasses = (masters?.classes?.length ?? 0) > 0;
  const hasLeads = admissionsLeadCount(admissions) > 0;
  // Staff can merge in successfully on a cold instance's first hydrate
  // while the desk-tables classes/sections read lags behind (e.g. a
  // transient timing hiccup) — hasStaff alone then reads "not empty" and
  // the 45s TTL guard skips retrying, so every request in that window
  // (attendance, homework, class WA channels, ...) works off zero classes.
  // Classes are load-bearing everywhere, so treat their absence as "looks
  // empty" regardless of what else came through, forcing a retry on the
  // very next call instead of caching the broken state for 45 seconds.
  if (!hasClasses) return true;
  return !hasSis && !hasStaff && !hasLeads;
}

export async function hydrateSchoolMirrorFromRemote(
  opts?: { force?: boolean },
): Promise<boolean> {
  const now = Date.now();
  const cur = getSchoolMirrorSync();
  if (
    !opts?.force &&
    !mirrorLooksEmpty(cur) &&
    now - lastHydrateMs < HYDRATE_TTL_MS
  ) {
    return false;
  }

  if (inFlightPromise && !opts?.force) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const remoteBlob = await fetchServerBlob<SchoolMirrorBundle>(
        "school_mirror_state",
      );
      const { sisReadFromDbEnabled } = await import("@/lib/sisDbConfig");
      const { feesReadFromDbEnabled } = await import("@/lib/feesDbConfig");
      const { paymentsReadFromDbEnabled } = await import("@/lib/paymentsDbConfig");
      const { admissionsReadFromDbEnabled } = await import(
        "@/lib/admissionsDbConfig"
      );
      let next: SchoolMirrorBundle = {
        version: 1,
        updatedAt: remoteBlob.updatedAt || cur.updatedAt || nowIso(),
        sis: sisReadFromDbEnabled()
          ? cur.sis
          : (remoteBlob.state?.sis ?? cur.sis),
        fees: feesReadFromDbEnabled()
          ? cur.fees
          : (remoteBlob.state?.fees ?? cur.fees),
        payments: paymentsReadFromDbEnabled()
          ? cur.payments
          : (remoteBlob.state?.payments ?? cur.payments),
        masters: remoteBlob.state?.masters ?? cur.masters,
        // Was unconditional — the only slice with no freshness guard.
        // admission_desk_leads has been the real admissions store for a
        // while now (ADMISSIONS_READ_FROM_DB); this stops anything reading
        // mirror.admissions (waCrmBotServer.ts's WhatsApp-name backfill is
        // the one confirmed live consumer) from silently working off a
        // stale blob copy once that flag is on. Matches the sis/fees/
        // payments pattern exactly — it does not shrink what's fetched
        // from Supabase, only which value gets used afterward. Shrinking
        // the stored blob itself is a separate, larger change: it needs
        // waCrmBotServer.ts's admissions dependency re-pointed at
        // fetchAdmissionDeskFromDb first, not just this route.
        admissions: admissionsReadFromDbEnabled()
          ? cur.admissions
          : (remoteBlob.state?.admissions ?? cur.admissions),
      };

      const { ensureSisHydratedServer } = await import("@/lib/sisPersistence");
      if (await ensureSisHydratedServer()) {
        const hydrated = getSchoolMirrorSync().sis as SisState | null;
        if (hydrated) {
          next = { ...next, sis: hydrated, updatedAt: nowIso() };
        }
      }

      const { ensureFeesHydratedServer } = await import("@/lib/feesPersistence.server");
      if (await ensureFeesHydratedServer()) {
        const hydrated = getSchoolMirrorSync().fees as FeesState | null;
        if (hydrated) {
          next = { ...next, fees: hydrated, updatedAt: nowIso() };
        }
      }

      const { ensurePaymentsHydratedServer } = await import(
        "@/lib/paymentsPersistence"
      );
      if (await ensurePaymentsHydratedServer()) {
        const hydrated = getSchoolMirrorSync().payments as PaymentsState | null;
        if (hydrated) {
          next = { ...next, payments: hydrated, updatedAt: nowIso() };
        }
      }

      // Masters must come from the desk tables when the cutover is on,
      // for the same reason sis/fees/payments do above. Without this the
      // server keeps serving the pre-cutover blob copy, whose class,
      // section, campus and fee-group ids were replaced when masters were
      // re-seeded. Everything server-side that resolves a class — the
      // WhatsApp bot, class-channel sync — then works in a dead id space
      // while the browser and the desk tables use the live one, and any
      // server write reintroduces the stale ids.
      const { mastersReadFromDbEnabled } = await import("@/lib/mastersDbConfig");
      if (mastersReadFromDbEnabled()) {
        const { fetchMastersDeskFromDb, deskBundleToMastersState } =
          await import("@/lib/mastersNormalized.server");
        const { bundle: mastersBundle } = await fetchMastersDeskFromDb();
        const deskMasters = deskBundleToMastersState(mastersBundle);
        if ((deskMasters.classes?.length ?? 0) > 0) {
          next = {
            ...next,
            masters: mergeDeskMastersOverBlob(
              next.masters as MastersState | null,
              deskMasters,
            ),
            updatedAt: nowIso(),
          };
        }
      }

      const mastersBase =
        (next.masters as MastersState | null) &&
        Array.isArray((next.masters as MastersState).classes)
          ? (next.masters as MastersState)
          : emptyMastersShell();
      const staffRemote = await fetchStaffRemoteServer();
      if (
        staffRemote &&
        (staffRemote.staff.length > 0 ||
          staffRemote.departments.length > 0 ||
          staffRemote.designations.length > 0)
      ) {
        next = {
          ...next,
          masters: mergeStaffRemoteIntoMasters(mastersBase, staffRemote),
          updatedAt: nowIso(),
        };
      }

      const { fetchSisFromDb } = await import("@/lib/sisNormalized.server");
      const { bundle: sisBundle } = await fetchSisFromDb();
      if (sisBundle.students.length > 0 || sisBundle.households.length > 0) {
        next = {
          ...next,
          sis: {
            version: 1,
            households: sisBundle.households,
            students: sisBundle.students,
            audit: [],
          },
          updatedAt: nowIso(),
        };
      }

      const [admissionsRemote] = await Promise.all([
        fetchAdmissionsRemoteServer(),
      ]);

      if (admissionsRemote && !admissionsStateIsEmpty(admissionsRemote)) {
        next = { ...next, admissions: admissionsRemote, updatedAt: nowIso() };
      }

      if (!next.fees) next = { ...next, fees: emptyFeesState() };
      if (!next.payments) next = { ...next, payments: emptyPaymentsState() };
      if (!next.masters) next = { ...next, masters: emptyMastersShell() };
      if (!next.sis) next = { ...next, sis: emptySisState() };
      if (!next.admissions) next = { ...next, admissions: defaultAdmissionsState() };

      replaceSchoolMirror(next);
      lastHydrateMs = Date.now();
      return true;
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}
