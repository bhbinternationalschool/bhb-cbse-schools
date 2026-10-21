"use client";

/**
 * The test-only subject editor behind /e2e/write-kernel (data-layer 1.5).
 *
 * Read: GET /api/data/masters.subjects — the slice's elements, each with its
 * own `_rev` (data-layer 2.2b). Write: one element through useSaveMutation,
 * base = that element's `_rev` as this screen read it. On a conflict it says so (the shared describeWriteFailure text) and
 * reads again, so the screen shows what the server holds — the other
 * writer's value — and never re-sends its own over it.
 */

import { useCallback, useEffect, useState } from "react";
import { readPage } from "@/lib/data/client/query";
import { useSaveMutation } from "@/lib/data/client/useSaveMutation";
import { asRevision, describeWriteFailure } from "@/lib/data/types";

type Subject = { id: string; nameEn?: string; code?: string; _rev?: number };

export function WriteKernelSubjects() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const mutation = useSaveMutation<Subject>("masters.subjects", { savedForMs: 0 });

  const load = useCallback(async () => {
    const res = await readPage<Subject>("masters.subjects", { limit: 1000 });
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setLoadError(null);
    setSubjects(res.rows);
    setDrafts({});
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(s: Subject) {
    setToast(null);
    const result = await mutation.save([
      // The element's `_rev` from the server's answer is its base.
      { op: "upsert", id: s.id, base: s._rev ? asRevision(String(s._rev)) : null, row: { nameEn: drafts[s.id] ?? s.nameEn ?? "" } },
    ]);
    // "Saved" only after the server said so; a failure in the one wording
    // every screen uses (describeWriteFailure).
    setToast(result.ok ? "Saved" : describeWriteFailure(result));
    await load();
  }

  if (loadError) return <p role="alert">Could not load subjects: {loadError}</p>;
  if (!subjects) return <p>Loading…</p>;

  return (
    <main className="p-6">
      <h1 className="text-lg font-semibold">Write kernel — subjects (test screen)</h1>
      {toast ? (
        <p role="status" data-testid="kernel-toast" className="my-3 rounded border p-2">
          {toast}
        </p>
      ) : null}
      <ul className="mt-4 space-y-2">
        {subjects.map((s) => (
          <li key={s.id} data-testid={`subject-${s.id}`} className="flex items-center gap-2">
            <span data-testid="subject-name">{s.nameEn ?? ""}</span>
            <input
              aria-label={`New name for ${s.id}`}
              className="rounded border px-2 py-1"
              value={drafts[s.id] ?? s.nameEn ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
            />
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={mutation.pending}
              onClick={() => void save(s)}
            >
              Save {s.id}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
