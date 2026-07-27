/**
 * Persist WhatsApp bot thread stores to Supabase (survives Cloud Run restarts).
 */

import { promises as fs } from "fs";
import path from "path";
import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";

export type WaBotPersistBundle = {
  version: 1;
  updatedAt: string;
  crm: unknown | null;
  sis: unknown | null;
  survey: unknown | null;
  classChannel: unknown | null;
};

const LOCAL_FILE = path.join(process.cwd(), ".data", "wa_bot_threads_bundle.json");

let cache: WaBotPersistBundle | null = null;
let loaded = false;

function emptyBundle(): WaBotPersistBundle {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    crm: null,
    sis: null,
    survey: null,
    classChannel: null,
  };
}

async function loadBundle(): Promise<WaBotPersistBundle> {
  if (loaded && cache) return cache;
  const remote = await fetchServerBlob<WaBotPersistBundle>("wa_bot_threads_state");
  if (remote.state?.version === 1) {
    cache = {
      version: 1,
      updatedAt: remote.updatedAt || remote.state.updatedAt || new Date().toISOString(),
      crm: remote.state.crm ?? null,
      sis: remote.state.sis ?? null,
      survey: remote.state.survey ?? null,
      classChannel: remote.state.classChannel ?? null,
    };
    loaded = true;
    return cache;
  }
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    const parsed = JSON.parse(raw) as WaBotPersistBundle;
    if (parsed?.version === 1) {
      cache = parsed;
      loaded = true;
      return parsed;
    }
  } catch {
    /* first run */
  }
  cache = emptyBundle();
  loaded = true;
  return cache;
}

async function saveBundle(bundle: WaBotPersistBundle): Promise<void> {
  cache = { ...bundle, version: 1, updatedAt: new Date().toISOString() };
  loaded = true;
  void pushServerBlob("wa_bot_threads_state", cache);
  try {
    await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await fs.writeFile(LOCAL_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* ephemeral disk */
  }
}

export async function loadWaBotSlice<T>(
  key: keyof Pick<WaBotPersistBundle, "crm" | "sis" | "survey" | "classChannel">,
  fallback: T,
): Promise<T> {
  const bundle = await loadBundle();
  const slice = bundle[key];
  if (slice && typeof slice === "object") return slice as T;
  return fallback;
}

export async function saveWaBotSlice<T>(
  key: keyof Pick<WaBotPersistBundle, "crm" | "sis" | "survey" | "classChannel">,
  value: T,
): Promise<void> {
  const bundle = await loadBundle();
  await saveBundle({ ...bundle, [key]: value });
}
