/**
 * Merging a slice desk's collection instead of replacing it.
 */

/**
 * The pushed rows, then every stored row whose id the push does not carry,
 * in their stored order. Rows without an id are kept as pushed.
 */
export function mergeSliceById(stored: unknown, incoming: unknown[]): unknown[] {
  const idOf = (r: unknown) =>
    r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string"
      ? (r as { id: string }).id
      : "";
  const pushed = new Set(incoming.map(idOf).filter(Boolean));
  const kept = (Array.isArray(stored) ? stored : []).filter((r) => {
    const id = idOf(r);
    return id !== "" && !pushed.has(id);
  });
  return [...incoming, ...kept];
}
