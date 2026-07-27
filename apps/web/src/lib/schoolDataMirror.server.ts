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
import { pushAdmissionsRemoteServer } from "@/lib/admissionsPersistence";

const DATA_FILE = path.join(process.cwd(), ".data", "school_mirror.json");

let registered = false;
let writing = false;
let writeQueued = false;

function nowIso() {
  return new Date().toISOString();
}

async function persistMirrorQuiet() {
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
    void persistMirrorQuiet();
  });
}

ensurePersistHook();

export async function ensureSchoolMirrorLoaded(): Promise<SchoolMirrorBundle> {
  ensurePersistHook();
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
  const pushed = await pushServerBlob("school_mirror_state", getSchoolMirrorSync());
  return {
    mirror: getSchoolMirrorSync(),
    supabaseSynced: pushed.ok,
    supabaseError: pushed.error,
    leadCount: admissionsLeadCount(getSchoolMirrorSync()),
  };
}
