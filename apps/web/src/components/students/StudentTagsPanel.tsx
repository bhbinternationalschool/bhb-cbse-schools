"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import {
  TAG_COLORS,
  createStudentTag,
  listStudentTags,
  toggleStudentTag,
  updateStudentTag,
} from "@/lib/studentTags";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";

export function StudentTagsPanel({
  tick = 0,
  onChanged,
}: {
  tick?: number;
  onChanged?: () => void;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]!);
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setMasters(loadMasters());
    const next = loadSis();
    listStudentTags(next);
    setSis(loadSis());
  }

  useEffect(() => {
    refresh();
  }, [tick]);

  const tags = useMemo(() => (sis ? listStudentTags(sis) : []), [sis]);

  const students = useMemo(() => {
    if (!sis || !masters) return [] as SisStudent[];
    let rows = sis.students.filter((s) => s.status === "active");
    if (classId) {
      rows = rows.filter(
        (s) =>
          s.classId === classId ||
          masters.sections.find((sec) => sec.id === s.sectionId)?.classId ===
            classId,
      );
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          s.rollNo.toLowerCase().includes(q),
      );
    }
    return rows
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, 80);
  }, [sis, masters, classId, query]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function onCreate(e: FormEvent) {
    e.preventDefault();
    const res = createStudentTag({ name, code: code || undefined, color });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName("");
    setCode("");
    flash(`Tag “${res.tag.name}” created`);
    refresh();
    onChanged?.();
  }

  function onToggle(studentId: string, tagId: string) {
    const res = toggleStudentTag(studentId, tagId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    refresh();
    onChanged?.();
  }

  if (!sis || !masters) {
    return <p className="mt-4 text-sm text-[var(--muted)]">Loading tags…</p>;
  }

  return (
    <div className="mt-4 space-y-5">
      <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
        <h2 className="text-base font-semibold text-[var(--brand-deep)]">
          Student tags
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Create tags and assign them to students. Tags always appear before the
          student name across the ERP (with N/P/M/R type).
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[rgba(67,160,71,0.12)] px-3 py-2 text-sm text-[#2e7d32]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={onCreate}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-[rgba(32,48,80,0.1)] bg-[#f8faf8] p-4"
      >
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Tag name
          </span>
          <input
            className="field !py-1.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hostel"
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Short code
          </span>
          <input
            className="field !max-w-[8rem] !py-1.5"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="HOST"
            maxLength={12}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Colour
          </span>
          <div className="flex gap-1">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-md border-2 ${
                  color === c ? "border-[var(--brand-deep)]" : "border-transparent"
                }`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
        </label>
        <button
          type="submit"
          className="btn-accent rounded-xl px-4 py-2 text-sm font-semibold"
        >
          + Create tag
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-2 rounded-lg border border-[rgba(32,48,80,0.1)] bg-white px-3 py-1.5 text-xs"
          >
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ background: t.color }}
            >
              {t.code}
            </span>
            <span className="font-medium text-[var(--brand-deep)]">{t.name}</span>
            <button
              type="button"
              className="text-[10px] font-semibold text-[#b71c1c]"
              onClick={() => {
                updateStudentTag(t.id, { isActive: false });
                flash(`Tag “${t.name}” archived`);
                refresh();
                onChanged?.();
              }}
            >
              Archive
            </button>
          </span>
        ))}
        {!tags.length ? (
          <p className="text-sm text-[var(--muted)]">No active tags yet.</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="field min-w-[12rem] flex-1"
          placeholder="Search student to assign tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="field max-w-[10rem]"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
        >
          <option value="">All classes</option>
          {masters.classes
            .filter((c) => c.isActive)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>

      <ErpTableShell exportAs="student_tags" exportTitle="Student tags">
        <ErpTable>
          <ErpTableHead>
            <tr>
              <th className="px-3 py-2 font-semibold">Student</th>
              <th className="px-3 py-2 font-semibold">Class</th>
              <th className="px-3 py-2 font-semibold">Assign tags</th>
              <th className="w-10 px-2 py-2" aria-label="Actions" />
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {students.map((s) => {
              const cls =
                masters.classes.find((c) => c.id === s.classId)?.name ?? "—";
              const sec =
                masters.sections.find((x) => x.id === s.sectionId)?.name ?? "";
              return (
                <tr key={s.id}>
                  <td className="px-3 py-2">
                    <StudentNameLabel student={s} sis={sis} />
                    <div className="text-[11px] text-[var(--muted)]">
                      {s.admissionNo}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {cls}
                    {sec ? `-${sec}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {tags.map((t) => {
                        const on = (s.tagIds ?? []).includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onToggle(s.id, t.id)}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                              on ? "ring-2 ring-[var(--brand-deep)] ring-offset-1" : "opacity-45"
                            }`}
                            style={{ background: t.color }}
                            title={on ? `Remove ${t.name}` : `Add ${t.name}`}
                          >
                            {t.code}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <RowActionMenu row={s} label="Student actions" actions={[{ id: "open", label: "Open student profile", onSelect: (x) => { window.location.href = `/students/${encodeURIComponent(String(x.id))}/edit`; } }]} />
                  </td>
                </tr>
              );
            })}
          </ErpTableBody>
        </ErpTable>
        {!students.length ? (
          <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">
            No students match.
          </p>
        ) : null}
      </ErpTableShell>
    </div>
  );
}
