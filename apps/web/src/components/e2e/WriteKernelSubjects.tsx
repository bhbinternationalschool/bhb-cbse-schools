"use client";

/**
 * The test-only subject editor behind /e2e/write-kernel (data-layer 1.5).
 *
 * Read: GET /api/data/masters.subjects — the slice's elements and its stamp.
 * Write: one element through useSaveMutation, base = the stamp this screen
 * read. On a conflict it says so (the shared describeWriteFailure text) and
 * reads again, so the screen shows what the server holds — the other
 * writer's value — and never re-sends its own over it.
 */

import { useCallback, useEffect, useState } from "react";
import { readPage } from "@/lib/data/client/query";
import { useSaveMutation } from "@/lib/data/client/useSaveMutation";
import { describeWriteFailure, type Revision } from "@/lib/data/types";

type Subject = { id: string; nameEn?: string; code?: string };

export function WriteKernelSubjects() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
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
    setRevision(res.revision ?? null);
    setDrafts({});
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(s: Subject) {
    setToast(null);
    const result = await mutation.save([
      { op: "upsert", id: s.id, base: revision, row: { nameEn: drafts[s.id] ?? s.nameEn ?? "" } },
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
