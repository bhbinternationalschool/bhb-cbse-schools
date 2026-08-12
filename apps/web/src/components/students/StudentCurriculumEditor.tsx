"use client";

import { useMemo, useState } from "react";
import type { MastersState } from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";
import type { Subject } from "@/lib/foundationMasters";
import {
  NCF_SUBJECT_TAGS,
  activeStreams,
  cartCatalog,
  cartProgress,
  catalogInNcfTag,
  classGroupForStudent,
  curriculumChoiceMode,
  groupSubjectsByNcf,
  languageSubtypeOf,
  ncfTagForSubject,
  offeringForClass,
  optionalOfferings,
  resolveStudentSubjects,
  streamLabel,
  type NcfTagId,
  type StudentCurriculum,
  validateCurriculum,
} from "@/lib/studentCurriculum";

const CART_TAGS: NcfTagId[] = ["A", "B", "C", "D"];

function subtypeLabel(s: Subject): string {
  const st = languageSubtypeOf(s);
  if (st === "native") return "Native";
  if (st === "regional") return "Regional";
  if (st === "foreign") return "Foreign";
  return "";
}

export function StudentCurriculumEditor({
  student,
  masters,
  curriculum,
  onChange,
  mode = "office",
  disabled = false,
}: {
  student: Pick<SisStudent, "classId" | "academicYearCode" | "curriculum">;
  masters: MastersState;
  curriculum: StudentCurriculum;
  onChange: (next: StudentCurriculum) => void;
  mode?: "office" | "parent";
  disabled?: boolean;
}) {
  const [addingTag, setAddingTag] = useState<NcfTagId | null>(null);
  const [showStreamHint, setShowStreamHint] = useState(false);

  const group = classGroupForStudent(student, masters);
  const choiceMode = curriculumChoiceMode(group);
  const canEdit = mode === "office" && !disabled;
  const isCart =
    choiceMode === "secondary_cart" || choiceMode === "senior_cart";
  const canChoose =
    !disabled &&
    (choiceMode === "middle_options" || isCart);

  const offerings = useMemo(
    () => offeringForClass(masters, student.classId),
    [masters, student.classId],
  );
  const optional = useMemo(() => optionalOfferings(offerings), [offerings]);
  const streams = useMemo(() => activeStreams(masters), [masters]);
  const catalog = useMemo(
    () => cartCatalog(masters, student.classId),
    [masters, student.classId],
  );

  const cartSubjects = useMemo(() => {
    if (isCart) {
      const byId = new Map(masters.subjects.map((s) => [s.id, s]));
      return curriculum.chosenSubjectIds
        .map((id) => byId.get(id))
        .filter((s): s is Subject => !!s && s.isActive);
    }
    return resolveStudentSubjects({ ...student, curriculum }, masters);
  }, [isCart, curriculum, masters, student]);

  const groupedCart = useMemo(
    () => groupSubjectsByNcf(cartSubjects),
    [cartSubjects],
  );

  const validation = validateCurriculum(student, curriculum, masters);
  const progress = cartProgress(choiceMode, cartSubjects);

  const enrolledIds = useMemo(
    () => new Set(cartSubjects.map((s) => s.id)),
    [cartSubjects],
  );

  const clsName =
    masters.classes.find((c) => c.id === student.classId)?.name ?? "—";

  function toggleInCart(id: string) {
    if (disabled) return;
    const on = curriculum.chosenSubjectIds.includes(id);
    const next = on
      ? curriculum.chosenSubjectIds.filter((x) => x !== id)
      : [...curriculum.chosenSubjectIds, id];

    // Same rule as addSubject: full is full. Refuse a new pick rather than
    // silently dropping one already chosen to make room for it.
    if (choiceMode === "middle_options" && !on && next.length > 2) return;
    if (isCart && !on && progress.target && next.length > progress.target) {
      return;
    }
    onChange({ ...curriculum, chosenSubjectIds: next });
  }

  function addSubject(id: string) {
    if (!canEdit) return;
    if (curriculum.chosenSubjectIds.includes(id)) return;
    const next = [...curriculum.chosenSubjectIds, id];
    if (choiceMode === "middle_options" && next.length > 2) return;
    // A full cart (7 for IX-X, 6 for XI-XII) refuses a new pick — it must
    // never silently drop an already-chosen subject to make room. That
    // silent swap was the bug: staff building a 7-subject cart from empty
    // never hit this path (cart isn't full at 1-2 picks), but anyone
    // topping up an existing cart would watch their last pick vanish with
    // no explanation each time they added one more.
    if (isCart && progress.target && next.length > progress.target) return;
    onChange({ ...curriculum, chosenSubjectIds: next });
    // Deliberately does NOT close the "+ Add" picker — see its key prop:
    // collapsing back to a button after every single pick meant adding the
    // 3 required languages took 3 separate "+ Add" clicks with no visual
    // cue that more could be added, which read as "only allows 1 / picking
    // another replaces it."
  }

  function removeSubject(id: string) {
    if (!canEdit && !canChoose) return;
    onChange({
      ...curriculum,
      chosenSubjectIds: curriculum.chosenSubjectIds.filter((x) => x !== id),
    });
  }

  function poolForTag(tagId: NcfTagId): Subject[] {
    if (choiceMode === "middle_options") {
      return optional
        .map((o) => o.subject)
        .filter((s) => ncfTagForSubject(s) === tagId);
    }
    return catalog.filter(
      (s) => ncfTagForSubject(s) === tagId && !enrolledIds.has(s.id),
    );
  }

  const modeHint =
    choiceMode === "none"
      ? "Fixed stage curriculum — office can still add if needed."
      : choiceMode === "middle_options"
        ? "Cores from class map · choose up to 2 options."
        : choiceMode === "secondary_cart"
          ? "Shopping cart · exactly 7 subjects · ≥3 languages · ≥1 skill/voc."
          : "Shopping cart · exactly 6 subjects · ≥2 languages · ≥1 native language.";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[var(--brand-deep)]">
            Subjects · {clsName}
          </p>
          <p className="text-[11px] text-[var(--muted)]">
            {modeHint}
            {mode === "parent" && canChoose
              ? " Submit a request for office approval."
              : null}
          </p>
        </div>
        {progress.target != null ? (
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
              progress.count === progress.target
                ? "bg-[rgba(15,118,110,0.12)] text-[#0f766e]"
                : "bg-[rgba(32,48,80,0.08)] text-[var(--brand-mid)]"
            }`}
          >
            Cart {progress.count}/{progress.target}
          </span>
        ) : null}
      </div>

      {(isCart || choiceMode === "middle_options") && progress.target != null ? (
        <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          <span>
            Lang {progress.languages}
            {choiceMode === "secondary_cart"
              ? "/3+"
              : choiceMode === "senior_cart"
                ? "/2+"
                : ""}
          </span>
          {choiceMode === "secondary_cart" ? (
            <span>Skill {progress.skill}/1+</span>
          ) : null}
          {choiceMode === "senior_cart" ? (
            <span>Native {progress.nativeLanguages}/1+</span>
          ) : null}
          {choiceMode === "senior_cart" && progress.labHeavy > 0 ? (
            <span>Lab-heavy {progress.labHeavy}</span>
          ) : null}
        </div>
      ) : null}

      {choiceMode === "senior_cart" && streams.length > 0 && canEdit ? (
        <div className="rounded-lg border border-dashed border-[rgba(32,48,80,0.15)] px-3 py-2">
          <button
            type="button"
            className="text-[11px] font-semibold text-[var(--brand-mid)]"
            onClick={() => setShowStreamHint((v) => !v)}
          >
            {showStreamHint ? "Hide" : "Optional"} counselor stream package
          </button>
          {showStreamHint ? (
            <label className="mt-2 block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Guidance only — enrollment is by subject cart, not stream
              </span>
              <select
                className="field !py-1.5"
                disabled={disabled}
                value={curriculum.seniorStreamId ?? ""}
                onChange={(e) =>
                  onChange({
                    ...curriculum,
                    seniorStreamId: e.target.value || null,
                  })
                }
              >
                <option value="">— None —</option>
                {streams.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.nameEn}
                  </option>
                ))}
              </select>
            </label>
          ) : curriculum.seniorStreamId ? (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Package · {streamLabel(masters, curriculum.seniorStreamId)}
            </p>
          ) : null}
        </div>
      ) : null}

      {choiceMode === "none" ? (
        canEdit ? (
          <FixedStageAdd
            masters={masters}
            enrolledIds={enrolledIds}
            addingTag={addingTag}
            setAddingTag={setAddingTag}
            onAdd={addSubject}
            onRemove={removeSubject}
            subjects={cartSubjects}
          />
        ) : (
          <div className="space-y-2">
            {groupedCart.map(({ group: tag, subjects: list }) => (
              <div
                key={tag.id}
                className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white"
              >
                <div className="border-b border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.03)] px-3 py-2">
                  <p className="text-xs font-bold text-[var(--brand-deep)]">
                    {tag.label}
                  </p>
                </div>
                <ul className="divide-y divide-[rgba(32,48,80,0.06)]">
                  {list.map((s) => (
                    <li key={s.id} className="px-3 py-2 text-sm">
                      <span className="font-semibold">{s.code}</span>{" "}
                      {s.nameEn}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : (
      <div className="space-y-3">
        {NCF_SUBJECT_TAGS.filter((t) => CART_TAGS.includes(t.id)).map((tag) => {
          const inBucket = cartSubjects.filter(
            (s) => ncfTagForSubject(s) === tag.id,
          );
          const pool = canChoose ? poolForTag(tag.id) : [];
          const addPool = canEdit
            ? catalogInNcfTag(masters, tag.id, enrolledIds)
            : [];

          if (
            inBucket.length === 0 &&
            pool.length === 0 &&
            addPool.length === 0
          ) {
            return null;
          }

          return (
            <div
              key={tag.id}
              className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.03)] px-3 py-2">
                <div>
                  <p className="text-xs font-bold text-[var(--brand-deep)]">
                    {tag.label}
                    {inBucket.length > 0 ? (
                      <span className="ml-1.5 font-semibold text-[var(--muted)]">
                        · {inBucket.length}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">{tag.hint}</p>
                </div>
                {canEdit && addPool.length > 0 ? (
                  <div className="flex items-center gap-1">
                    {addingTag === tag.id ? (
                      <>
                        <select
                          // Remounts on every pick, forcing the uncontrolled
                          // select back to the "Add…" placeholder instead of
                          // sticking on the subject just chosen — the visual
                          // cue that another pick is still possible.
                          key={inBucket.length}
                          className="field !py-1 text-xs"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) addSubject(e.target.value);
                          }}
                        >
                          <option value="">Add…</option>
                          {addPool.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.code} — {s.nameEn}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[var(--muted)]"
                          onClick={() => setAddingTag(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[11px] font-bold text-[var(--brand-mid)]"
                        onClick={() => setAddingTag(tag.id)}
                      >
                        + Add
                      </button>
                    )}
                  </div>
                ) : null}
              </div>

              {inBucket.length > 0 ? (
                <ul className="divide-y divide-[rgba(32,48,80,0.06)]">
                  {inBucket.map((s) => {
                    const sub = subtypeLabel(s);
                    return (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span>
                          <span className="font-semibold text-[var(--brand-deep)]">
                            {s.code}
                          </span>{" "}
                          {s.nameEn}
                          {sub ? (
                            <span className="ml-1.5 rounded bg-[rgba(15,118,110,0.1)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#0f766e]">
                              {sub}
                            </span>
                          ) : null}
                        </span>
                        {(canEdit || canChoose) &&
                        curriculum.chosenSubjectIds.includes(s.id) ? (
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-[var(--danger)]"
                            onClick={() => removeSubject(s.id)}
                            disabled={disabled}
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-3 py-2 text-xs text-[var(--muted)]">
                  Empty — pick from the list below.
                </p>
              )}

              {canChoose && pool.length > 0 ? (
                <div className="border-t border-[rgba(32,48,80,0.08)] px-3 py-2">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Available
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {pool.map((s) => {
                      const on = curriculum.chosenSubjectIds.includes(s.id);
                      const sub = subtypeLabel(s);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={disabled}
                          title={`${s.nameEn}${sub ? ` (${sub})` : ""}`}
                          onClick={() => toggleInCart(s.id)}
                          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                            on
                              ? "bg-[var(--brand-deep)] text-white"
                              : "border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.02)] text-[var(--brand-deep)]"
                          }`}
                        >
                          {s.code}
                          {sub ? (
                            <span className="ml-1 opacity-70">
                              · {sub[0]}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      )}

      {validation.warnings.length > 0 ? (
        <ul className="rounded-lg bg-[rgba(196,149,58,0.12)] px-3 py-2 text-xs text-[var(--brand-gold)]">
          {validation.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {!validation.ok ? (
        <ul className="rounded-lg bg-[rgba(180,60,60,0.08)] px-3 py-2 text-xs text-[var(--danger)]">
          {validation.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FixedStageAdd({
  masters,
  enrolledIds,
  addingTag,
  setAddingTag,
  onAdd,
  onRemove,
  subjects,
}: {
  masters: MastersState;
  enrolledIds: Set<string>;
  addingTag: NcfTagId | null;
  setAddingTag: (t: NcfTagId | null) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  subjects: Subject[];
}) {
  const grouped = groupSubjectsByNcf(subjects);
  return (
    <div className="space-y-2">
      {grouped.map(({ group, subjects: list }) => (
        <div
          key={group.id}
          className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white"
        >
          <div className="flex items-center justify-between border-b border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.03)] px-3 py-2">
            <p className="text-xs font-bold text-[var(--brand-deep)]">
              {group.label}
            </p>
            {addingTag === group.id ? (
              <select
                key={enrolledIds.size}
                className="field !py-1 text-xs"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) onAdd(e.target.value);
                }}
              >
                <option value="">Add…</option>
                {catalogInNcfTag(masters, group.id, enrolledIds).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.nameEn}
                  </option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                className="text-[11px] font-bold text-[var(--brand-mid)]"
                onClick={() => setAddingTag(group.id)}
              >
                + Add
              </button>
            )}
          </div>
          <ul className="divide-y divide-[rgba(32,48,80,0.06)]">
            {list.map((s) => (
              <li
                key={s.id}
                className="flex justify-between px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-semibold">{s.code}</span> {s.nameEn}
                </span>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[var(--danger)]"
                  onClick={() => onRemove(s.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
