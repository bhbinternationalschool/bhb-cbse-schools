/**
 * Write one desk slice row only if nobody wrote it since we read it.
 *
 * A slice row holds a whole list, and every writer did read → merge → write.
 * Two writers at once (the transport desk save and a driver's boarding tap)
 * each merged into the copy they had read, and whichever wrote second
 * silently threw the other's change away. Here the write is conditional on
 * the row's `updated_at` still being what was read; if another write landed
 * in between, the row is read again and the change re-applied on top of it.
 *
 * No migration: `updated_at` already exists on every *_desk_slices table.
 * Each write stamps a microsecond-precision time with a random tail, so two
 * writes can't end up with the same stamp and pass each other's check.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** An ISO time with microseconds, unique enough to serve as a write stamp. */
export function sliceWriteStamp(now = new Date()): string {
  const iso = now.toISOString(); // 2026-10-09T13:00:00.123Z
  const micros = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `${iso.slice(0, 23)}${micros}Z`;
}

export type SliceCasResult =
  | { ok: true; payload: unknown; attempts: number }
  | { ok: false; error: string };

/**
 * @param compute the new payload from the stored one (undefined when the row
 *   does not exist yet). Called again on every retry with the fresh payload,
 *   so it must be a pure function of its argument.
 */
export async function casWriteSlice(
  sb: SupabaseClient,
  table: string,
  tenantId: string,
  sliceKey: string,
  compute: (stored: unknown) => unknown,
  opts: { maxAttempts?: number } = {},
): Promise<SliceCasResult> {
  const max = opts.maxAttempts ?? 6;
  for (let attempt = 1; attempt <= max; attempt++) {
    const { data, error } = await sb
      .from(table)
      .select("payload, updated_at")
      .eq("tenant_id", tenantId)
      .eq("slice_key", sliceKey)
      .maybeSingle();
    if (error) return { ok: false, error: `${table}/${sliceKey}: ${error.message}` };

    const row = data as { payload: unknown; updated_at: string } | null;
    const next = compute(row ? row.payload : undefined);
    const stamp = sliceWriteStamp();

    if (row) {
      const { data: won, error: upErr } = await sb
        .from(table)
        .update({ payload: next, updated_at: stamp })
        .eq("tenant_id", tenantId)
        .eq("slice_key", sliceKey)
        .eq("updated_at", row.updated_at)
        .select("slice_key");
      if (upErr) return { ok: false, error: `${table}/${sliceKey}: ${upErr.message}` };
      if (won?.length) return { ok: true, payload: next, attempts: attempt };
    } else {
      const { error: insErr } = await sb
        .from(table)
        .insert({ tenant_id: tenantId, slice_key: sliceKey, payload: next, updated_at: stamp });
      if (!insErr) return { ok: true, payload: next, attempts: attempt };
      // 23505: someone created the row first — read it and merge into theirs.
      if (insErr.code !== "23505") return { ok: false, error: `${table}/${sliceKey}: ${insErr.message}` };
    }
    // Lost the race: back off a little and re-apply on the fresh copy.
    await new Promise((r) => setTimeout(r, 20 * attempt + Math.floor(Math.random() * 30)));
  }
  return {
    ok: false,
    error: `${table}/${sliceKey}: still changing after ${max} attempts — nothing was overwritten; try again.`,
  };
}
