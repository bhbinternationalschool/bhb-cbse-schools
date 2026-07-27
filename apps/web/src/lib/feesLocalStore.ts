/**
 * IndexedDB backing store for fees when localStorage quota is exceeded.
 */

import type { FeesState } from "@/lib/fees";

const DB_NAME = "bhb_erp_v1";
const DB_VERSION = 1;
const STORE = "domain_state";
const FEES_KEY = "fees";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export function feesIdbAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export async function readFeesFromIdb(): Promise<FeesState | null> {
  if (!feesIdbAvailable()) return null;
  try {
    const db = await openDb();
    return await new Promise<FeesState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(FEES_KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as FeesState | undefined) ?? null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return null;
  }
}

export async function writeFeesToIdb(state: FeesState): Promise<void> {
  if (!feesIdbAvailable()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(state, FEES_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export const FEES_USE_IDB_FLAG = "bhb_fees_v1_use_idb";

export function feesPreferIdb(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(FEES_USE_IDB_FLAG) === "1";
}

export function markFeesPreferIdb(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(FEES_USE_IDB_FLAG, "1");
}
