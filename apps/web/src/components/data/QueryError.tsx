"use client";

import { useState } from "react";

/**
 * The one "could not load / Try again" for a failed kernel query
 * (data-layer 1.4, R6): a read failure is shown as a failure — never as an
 * empty list. Same words and controls as CoreDataGate's failure state, so a
 * person meets one message whichever layer failed.
 *
 *   const q = useMasters();
 *   if (q.isError) return <QueryError what="the school's classes" error={q.error} retry={q.refetch} />;
 */
export function QueryError({
  what,
  error,
  retry,
}: {
  /** What did not load, e.g. "the school's classes, subjects and staff". */
  what: string;
  error: unknown;
  retry: () => unknown;
}) {
  const [busy, setBusy] = useState(false);
  const detail = error instanceof Error && error.message ? error.message : "";
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-[var(--muted)]" role="alert">
      <p className="font-medium text-[var(--danger)]">Could not load {what} from the server.</p>
      {detail ? <p className="max-w-md text-center text-xs">{detail}</p> : null}
      <button
        type="button"
        disabled={busy}
        className="rounded-lg border border-[var(--border)] px-4 py-2 font-semibold text-[var(--brand-deep)] disabled:opacity-60"
        onClick={() => {
          setBusy(true);
          void Promise.resolve(retry()).finally(() => setBusy(false));
        }}
      >
        Try again
      </button>
    </div>
  );
}
