/**
 * School data mirror — Node disk persistence (API / WhatsApp bot only).
 * Do not import this file from Client Components.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  getSchoolMirrorSync,
  registerSchoolMirrorDiskPersist,
  replaceSchoolMirror,
  type SchoolMirrorBundle,
} from "@/lib/schoolDataMirror";
import { hydrateSchoolMirrorFromRemote } from "@/lib/schoolMirrorRemote.server";
import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";
import type { AdmissionsState } from "@/lib/admissions";
import type { MastersState } from "@/lib/masters";
import { pushAdmissionsRemoteServer } from "@/lib/admissionsPersistence";
import { stripStaffFromMastersForBlob } from "@/lib/staffPersistence";
import {
  deskSkipMirrorBlobSlice,
  type MirrorBlobSlice,
} from "@/lib/deskCutover";
import { trackServerWork } from "@/lib/serverWork";

const DATA_FILE = path.join(process.cwd(), ".data", "school_mirror.json");

let registered = false;
let writing = false;
let writeQueued = false;
/** Production: the disk copy has been read once in this process. */
let diskReadOnce = false;

/**
 * Whether the disk copy is used at all (data-layer 0.5d).
 *
 * The in-memory mirror (lib/schoolDataMirror.ts `memory`) is one per server
 * process: every App Router route handler is bundled with the single shared
 * `webpack-runtime` chunk (next/dist/build/entries.js finalizeEntrypoint) and
 * the rsc layer, so they share one module cache and one `memory`. The file
 * synced nothing between instances — it re-read, per call, what this same
 * process had written (a ~4 MB JSON.parse on every mobile request, and a
 * whole-mirror JSON.stringify + write held on every reply). It could even
 * put back an older snapshot over a newer memory copy while a write was
 * queued. Cloud Run's disk is per instance and empty at start, so in
 * production the file is off: read at most once per process, never written.
 * Local dev keeps it (a restarted `next dev` picks its mirror back up).
 */
function diskMirrorEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

function nowIso() {
  return new Date().toISOString();
}

async function persistMirrorQuiet() {
  if (!diskMirrorEnabled()) return;
  if (writing) {
    writeQueued = true;
    return;
  }
  writing = true;
  try {
    do {
      writeQueued = false;
      const snap = getSchoolMirrorSync();
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(snap), "utf8");
    } while (writeQueued);
  } catch {
    /* ephemeral runtime */
  } finally {
    writing = false;
  }
}

function ensurePersistHook() {
  if (registered) return;
  registered = true;
  registerSchoolMirrorDiskPersist(() => {
    // Production: no write, and nothing for the reply to wait on.
    if (!diskMirrorEnabled()) return;
    void trackServerWork(persistMirrorQuiet());
  });
}

ensurePersistHook();

export async function ensureSchoolMirrorLoaded(): Promise<SchoolMirrorBundle> {
  ensurePersistHook();
  if (!diskMirrorEnabled()) {
    if (diskReadOnce) return getSchoolMirrorSync();
    diskReadOnce = true;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as SchoolMirrorBundle;
    if (parsed?.version === 1) {
      replaceSchoolMirror({
        version: 1,
        updatedAt: parsed.updatedAt || nowIso(),
        sis: parsed.sis ?? null,
        fees: parsed.fees ?? null,
        payments: parsed.payments ?? null,
        masters: parsed.masters ?? null,
        admissions: parsed.admissions ?? null,
      });
    }
  } catch {
    /* first run / serverless */
  }
  return getSchoolMirrorSync();
}

/** Load mirror + hydrate from Supabase for WhatsApp / server APIs. */
export async function ensureSchoolMirrorHydrated(
  opts?: { force?: boolean },
): Promise<SchoolMirrorBundle> {
  await ensureSchoolMirrorLoaded();
  await hydrateSchoolMirrorFromRemote(opts);
  return getSchoolMirrorSync();
}

export type WriteSchoolMirrorResult = {
  mirror: SchoolMirrorBundle;
  supabaseSynced: boolean;
  supabaseError?: string;
  leadCount: number;
};

function admissionsLeadCount(bundle: SchoolMirrorBundle): number {
  const adm = bundle.admissions as AdmissionsState | null;
  return Array.isArray(adm?.leads) ? adm.leads.length : 0;
}

function buildMirrorBlobPayload(
  memory: SchoolMirrorBundle,
  remoteBase: SchoolMirrorBundle,
): SchoolMirrorBundle {
  const pick = <K extends MirrorBlobSlice>(key: K): SchoolMirrorBundle[K] =>
    deskSkipMirrorBlobSlice(key) ? remoteBase[key] : memory[key];

  return {
    version: 1,
    updatedAt: memory.updatedAt,
    sis: pick("sis"),
    fees: pick("fees"),
    payments: pick("payments"),
    masters: deskSkipMirrorBlobSlice("masters")
      ? remoteBase.masters
      : memory.masters
        ? stripStaffFromMastersForBlob(memory.masters as MastersState)
        : memory.masters,
    admissions: pick("admissions"),
  };
}

function patchOnlyExcludedBlobSlices(
  patch: Partial<
    Pick<SchoolMirrorBundle, "sis" | "fees" | "payments" | "masters" | "admissions">
  >,
): boolean {
  const blobKeys = (Object.keys(patch) as MirrorBlobSlice[]).filter(
    (key) =>
      key === "sis" ||
      key === "fees" ||
      key === "payments" ||
      key === "admissions" ||
      key === "masters",
  );
  if (blobKeys.length === 0) return false;
  return blobKeys.every((key) => deskSkipMirrorBlobSlice(key));
}

export async function writeSchoolMirror(
  patch: Partial<
    Pick<
      SchoolMirrorBundle,
      "sis" | "fees" | "payments" | "masters" | "admissions"
    >
  >,
): Promise<WriteSchoolMirrorResult> {
  await ensureSchoolMirrorLoaded();
  const remote = await fetchServerBlob<SchoolMirrorBundle>("school_mirror_state");
  const memory = getSchoolMirrorSync();
  const base =
    remote.state?.version === 1 && remote.state ? remote.state : memory;
  let patchToApply = { ...patch };
  if (patch.admissions !== undefined) {
    const remoteLeads = admissionsLeadCount(base);
    const patchLeads = admissionsLeadCount({
      ...base,
      admissions: patch.admissions,
    });
    if (patchLeads < remoteLeads && base.admissions) {
      const { admissions: _drop, ...rest } = patchToApply;
      patchToApply = rest;
    }
  }
  const next: SchoolMirrorBundle = {
    ...base,
    ...patchToApply,
    version: 1,
    updatedAt: nowIso(),
  };
  replaceSchoolMirror(next);
  await persistMirrorQuiet();
  if (patchToApply.admissions !== undefined) {
    await pushAdmissionsRemoteServer(
      getSchoolMirrorSync().admissions as AdmissionsState,
    );
  }

  const onlyExcludedSlices =
    Object.keys(patchToApply).length > 0 &&
    patchOnlyExcludedBlobSlices(patchToApply);
  if (onlyExcludedSlices) {
    return {
      mirror: getSchoolMirrorSync(),
      supabaseSynced: true,
      leadCount: admissionsLeadCount(getSchoolMirrorSync()),
    };
  }

  const allMirrorSlicesDrp = (
    ["sis", "fees", "payments", "masters", "admissions"] as MirrorBlobSlice[]
  ).every((slice) => deskSkipMirrorBlobSlice(slice));

  const blobPayload = buildMirrorBlobPayload(getSchoolMirrorSync(), base);
  if (allMirrorSlicesDrp) {
    return {
      mirror: getSchoolMirrorSync(),
      supabaseSynced: true,
      leadCount: admissionsLeadCount(getSchoolMirrorSync()),
    };
  }
  const pushed = await pushServerBlob("school_mirror_state", blobPayload);
  return {
    mirror: getSchoolMirrorSync(),
    supabaseSynced: pushed.ok,
    supabaseError: pushed.error,
    leadCount: admissionsLeadCount(getSchoolMirrorSync()),
  };
}
