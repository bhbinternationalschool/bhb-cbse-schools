"use client";

import { QueryError } from "@/components/data/QueryError";
import { useMasters } from "@/lib/data/client/hooks";

/**
 * The /__kernel test page's body (data-layer 1.4, e2e stack only): every
 * active class with its sections and its active subjects, read through
 * useMasters() and nothing else — no desk copy, no bhb-* event. When the
 * versions poll sees Masters move, this list re-renders from the new answer.
 */
export function KernelProbe() {
  const q = useMasters();
  if (q.isPending) {
    return (
      <p role="status" className="p-6 text-sm text-[var(--muted)]">
        Loading classes…
      </p>
    );
  }
  if (q.isError) {
    return <QueryError what="the school's classes" error={q.error} retry={() => q.refetch()} />;
  }
  const { scope, masters } = q.data;
  const subjectName = new Map(masters.subjects.map((s) => [s.id, s.nameEn]));
  const classes = masters.classes.filter((c) => c.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <section className="space-y-4 p-6" aria-label="Kernel classes">
      <h1 className="text-lg font-semibold text-[var(--brand-deep)]">Query kernel</h1>
      <p className="text-sm text-[var(--muted)]" data-testid="kernel-summary">
        Scope: {scope} · {classes.length} classes{q.isFetching ? " · refreshing" : ""}
      </p>
      <ul className="space-y-3" aria-label="Classes">
        {classes.map((c) => {
          const sections = masters.sections.filter((s) => s.classId === c.id && s.isActive !== false);
          const subjects = masters.classSubjects
            .filter((l) => l.classId === c.id && l.isActive !== false)
            .map((l) => ({ id: l.id, name: subjectName.get(l.subjectId) ?? "" }))
            .filter((s) => !!s.name);
          return (
            <li key={c.id} aria-label={`Class ${c.name}`} className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <strong>{c.name}</strong>
              <ul aria-label={`Sections of ${c.name}`} className="mt-1 flex flex-wrap gap-2">
                {sections.map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
              </ul>
              <ul aria-label={`Subjects of ${c.name}`} className="mt-1 flex flex-wrap gap-2 text-[var(--muted)]">
                {subjects.map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
