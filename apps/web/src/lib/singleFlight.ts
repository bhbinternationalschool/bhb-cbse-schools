/**
 * One call at a time per key: a second caller with the same key while the
 * first is still running gets the first one's result instead of starting its
 * own. Used where a double tap would otherwise make two payment links (and
 * two gateway orders) for the same dues — both requests read "no open link
 * yet" before either had saved one (director, 9 Oct 2026). Per process only;
 * the reuse check in createPaymentLink covers taps that land later.
 */

const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}
