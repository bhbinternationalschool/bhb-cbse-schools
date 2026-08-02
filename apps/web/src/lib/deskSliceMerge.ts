/**
 * Merge desk bundle into local slice state.
 */

export function mergeDeskSliceBundle<T extends { version: number }>(
  local: T,
  bundle: Record<string, unknown>,
  opts: { preferDb: boolean },
): T {
  const { version, ...localRest } = local as T & Record<string, unknown>;
  if (opts.preferDb) {
    return { version, ...bundle } as T;
  }
  const next: Record<string, unknown> = { ...localRest };
  for (const [key, value] of Object.entries(bundle)) {
    if (Array.isArray(value) && value.length > 0) next[key] = value;
    else if (value != null && !Array.isArray(value)) next[key] = value;
  }
  return { version, ...next } as T;
}
