/**
 * Conflict answers without secrets (data-layer 2.2b). Pure — used by the
 * repo (lib/data/server/repo.ts) on every conflict it returns, and
 * self-tested in answerRedaction.selftest.ts.
 */
import type { CollectionDef } from "./registry";

type Row = Record<string, unknown>;

/**
 * A stored row as it may leave the server in a conflict answer: the
 * collection's `answerRedaction` keys removed (registry; data-layer 2.2b —
 * desk_write_guarded returns the WHOLE stored row with a refusal, and for
 * sis_staff that carried bank, Aadhaar, PAN, pay and the login).
 */
export function redactStoredForAnswer(def: CollectionDef | undefined, stored: Row): Row {
  const rule = def?.answerRedaction;
  if (!rule || !stored || typeof stored !== "object") return stored;
  const out: Row = { ...stored };
  for (const c of rule.columns ?? []) delete out[c];
  for (const [col, keys] of Object.entries(rule.jsonb ?? {})) {
    const v = out[col];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = { ...(v as Row) };
      for (const k of keys) delete inner[k];
      out[col] = inner;
    }
  }
  return out;
}

