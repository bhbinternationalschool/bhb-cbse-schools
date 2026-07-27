/**
 * Server-side ERP chat store (Node disk) for authorized API routes.
 * Merges with client blob sync; demo-friendly without Supabase.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  emptyErpChatState,
  mergeErpChatStates,
  normalizeErpChatState,
  type ErpChatState,
} from "@/lib/erpChat";

const DATA_FILE = path.join(process.cwd(), ".data", "erp_chat.json");

let cache: ErpChatState | null = null;

export async function loadErpChatServer(): Promise<ErpChatState> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    cache = normalizeErpChatState(JSON.parse(raw));
    return cache;
  } catch {
    cache = emptyErpChatState();
    return cache;
  }
}

export async function saveErpChatServer(state: ErpChatState): Promise<ErpChatState> {
  const next = normalizeErpChatState(state);
  cache = next;
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(next), "utf8");
  } catch {
    /* ephemeral */
  }
  return next;
}

export async function mergeErpChatServer(
  incoming: ErpChatState,
): Promise<ErpChatState> {
  const local = await loadErpChatServer();
  const merged = mergeErpChatStates(local, normalizeErpChatState(incoming));
  return saveErpChatServer(merged);
}
