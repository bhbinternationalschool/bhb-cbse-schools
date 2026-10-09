/**
 * Persist WhatsApp bot thread stores to Supabase (survives Cloud Run restarts).
 */

import { promises as fs } from "fs";
import path from "path";
import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";
import { trackServerWork } from "@/lib/serverWork";

export type WaBotPersistBundle = {
  version: 1;
  updatedAt: string;
  crm: unknown | null;
  sis: unknown | null;
  survey: unknown | null;
  classChannel: unknown | null;
  unified: unknown | null;
  hub: unknown | null;
  staffAtt: unknown | null;
  complaints: unknown | null;
  /** ERP command desk — pause switch, pending confirms, hourly usage. */
  commands: unknown | null;
  /**
   * Study-help sessions: which child and which mode each household number
   * is currently in. Its own slice rather than a field on the SIS thread,
   * so the tutor cannot change the shape of the store the fee and receipt
   * flows read.
   */
  tutor: unknown | null;
};

const LOCAL_FILE = path.join(process.cwd(), ".data", "wa_bot_threads_bundle.json");

let cache: WaBotPersistBundle | null = null;
let loaded = false;
/**
 * The last load could not read the desk and fell back to an empty bundle.
 * Unknown is not empty: until a read succeeds, no slice may be written — a
 * slice saved on top of that empty fallback replaced the stored slice (every
 * SIS or CRM thread) with the one conversation in hand.
 */
let deskUnreadable = false;

function emptyBundle(): WaBotPersistBundle {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    crm: null,
    sis: null,
    survey: null,
    classChannel: null,
    unified: null,
    hub: null,
    staffAtt: null,
    complaints: null,
    commands: null,
    tutor: null,
  };
}

async function loadBundle(): Promise<WaBotPersistBundle> {
  if (loaded && cache) return cache;

  const { waThreadsReadFromDbEnabled } = await import("@/lib/waThreadsDbConfig");
  const { fetchWaThreadsDeskFromDb } = await import(
    "@/lib/waThreadsNormalized.server"
  );
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let readFailed = false;
  if (waThreadsReadFromDbEnabled()) {
    const desk = await fetchWaThreadsDeskFromDb();
    if (!desk.ok) readFailed = true;
    if (desk.ok && (desk.meta?.sliceCount ?? 0) > 0) {
      cache = desk.bundle;
      loaded = true;
      deskUnreadable = false;
      return cache;
    }
  }

  if (!deskSkipBlobPush("wa_threads")) {
    const remote = await fetchServerBlob<WaBotPersistBundle>("wa_bot_threads_state");
    if (remote.state?.version === 1) {
      cache = {
        version: 1,
        updatedAt: remote.updatedAt || remote.state.updatedAt || new Date().toISOString(),
        crm: remote.state.crm ?? null,
        sis: remote.state.sis ?? null,
        survey: remote.state.survey ?? null,
        classChannel: remote.state.classChannel ?? null,
        unified: remote.state.unified ?? null,
        hub: remote.state.hub ?? null,
        staffAtt: remote.state.staffAtt ?? null,
        complaints: remote.state.complaints ?? null,
        commands: remote.state.commands ?? null,
        tutor: remote.state.tutor ?? null,
      };
      loaded = true;
      deskUnreadable = false;
      return cache;
    }
  }

  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    const parsed = JSON.parse(raw) as WaBotPersistBundle;
    if (parsed?.version === 1) {
      cache = parsed;
      loaded = true;
      deskUnreadable = false;
      return parsed;
    }
  } catch {
    /* first run */
  }

  const desk = await fetchWaThreadsDeskFromDb();
  if (!desk.ok) readFailed = true;
  if (desk.ok && (desk.meta?.sliceCount ?? 0) > 0) {
    cache = desk.bundle;
    loaded = true;
    deskUnreadable = false;
    return cache;
  }

  if (readFailed) {
    // Not cached: the next call reads again.
    deskUnreadable = true;
    return emptyBundle();
  }
  cache = emptyBundle();
  loaded = true;
  deskUnreadable = false;
  return cache;
}

export async function loadWaBotSlice<T>(
  key: keyof Pick<
    WaBotPersistBundle,
    | "crm"
    | "sis"
    | "survey"
    | "classChannel"
    | "unified"
    | "hub"
    | "staffAtt"
    | "complaints"
    | "commands"
    | "tutor"
  >,
  fallback: T,
): Promise<T> {
  const bundle = await loadBundle();
  const slice = bundle[key];
  if (slice && typeof slice === "object") return slice as T;
  return fallback;
}

export async function saveWaBotSlice<T>(
  key: keyof Pick<
    WaBotPersistBundle,
    | "crm"
    | "sis"
    | "survey"
    | "classChannel"
    | "unified"
    | "hub"
    | "staffAtt"
    | "complaints"
    | "commands"
    | "tutor"
  >,
  value: T,
): Promise<void> {
  const bundle = await loadBundle();
  if (deskUnreadable) {
    console.error(
      `[wa-bot-store] NOT saving the ${key} slice: the desk could not be read, ` +
        "and writing on top of an empty fallback would replace the stored conversations.",
    );
    return;
  }
  // Nothing changed → nothing to write. Several bot paths save on every
  // message whether or not their slice moved.
  try {
    if (JSON.stringify(bundle[key] ?? null) === JSON.stringify(value ?? null)) return;
  } catch {
    /* not serialisable as-is — fall through and save */
  }
  const next: WaBotPersistBundle = {
    ...bundle,
    [key]: value,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  cache = next;
  loaded = true;

  const { pushWaThreadsSliceToDb } = await import("@/lib/waThreadsNormalized.server");
  const desk = await pushWaThreadsSliceToDb(key, value, next).catch(
    (e: unknown) => ({ ok: false as const, error: (e as Error)?.message || String(e) }),
  );
  if (!desk.ok) {
    console.error("[wa-bot-store] DESK PUSH FAILED — bot threads are NOT persisting:", desk.error);
  }

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (!deskSkipBlobPush("wa_threads")) {
    void trackServerWork(pushServerBlob("wa_bot_threads_state", next));
  }
  // A pretty-printed copy of the whole bundle on every message cost CPU on
  // the one-CPU server and bought nothing: Cloud Run's disk is thrown away.
  if (process.env.NODE_ENV !== "production") {
    try {
      await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
      await fs.writeFile(LOCAL_FILE, JSON.stringify(next), "utf8");
    } catch {
      /* ephemeral disk */
    }
  }
}
