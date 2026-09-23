/**
 * Self-test: the menu of agreed micro-skills a drill question may be set from.
 * Run: npx tsx apps/web/src/lib/drillSkills.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildSkillMenu,
  foundationLine,
  refsForComponentIds,
  renderSkillMenu,
  skillAtRef,
  type SkillsByPosition,
} from "@/lib/drillSkills";

console.log("drillSkills.selftest.ts");

const by = (rows: [number, string, string][]): SkillsByPosition => {
  const m: SkillsByPosition = new Map();
  for (const [position, componentId, description] of rows) {
    const list = m.get(position) ?? [];
    list.push({ componentId, description });
    m.set(position, list);
  }
  return m;
};

/* ── scope is the boundary, and it is not advisory ──────────────────── */
{
  const menu = buildSkillMenu(
    by([
      [2, "c-a", "Fluently add within 10"],
      [5, "c-b", "Multiply a fraction by a whole number"],
      [9, "c-c", "Use proportional relationships"],
    ]),
    5,
  );
  // The bug this guards: a menu item from chapter 9 in front of a model told
  // to ask from chapters 1–5 is an invitation to ask from chapter 9. The
  // child has not been taught it.
  assert.deepEqual(menu.map((s) => s.position), [2, 5]);

  assert.deepEqual(buildSkillMenu(by([[1, "c", "x"]]), 0), [], "no scope, no menu");
}

/* ── the same inputs give the same numbers, on every turn ───────────── */
{
  // Insertion order differs; the menu must not.
  const one = buildSkillMenu(by([[3, "c-b", "Subtract within 20"], [3, "c-a", "Add within 20"]]), 3);
  const two = buildSkillMenu(by([[3, "c-a", "Add within 20"], [3, "c-b", "Subtract within 20"]]), 3);
  assert.deepEqual(one, two, "a menu is a function of its data, not of read order");
  assert.equal(one[0]!.componentId, "c-a", "sorted by the sentence");

  // The bug this guards: if the order moved between turns, `avoidRefs` from
  // question 1 would name a different idea by question 4, and the model would
  // be told to avoid something it had not asked.
  assert.equal(skillAtRef(one, 1)?.description, "Add within 20");
}

/* ── the caps keep a long paper's menu readable ─────────────────────── */
{
  const rows: [number, string, string][] = [];
  for (let p = 1; p <= 12; p++) for (let i = 0; i < 6; i++) rows.push([p, `c-${p}-${i}`, `Skill ${p}.${i}`]);
  const menu = buildSkillMenu(by(rows), 12);

  assert.equal(menu.length, 30, "capped in total");
  assert.equal(menu.filter((s) => s.position === 1).length, 3, "and per chapter");
  // Breadth over depth: the cap must not spend the whole menu on chapter 1.
  assert.equal(new Set(menu.map((s) => s.position)).size, 10);
}

/* ── an empty menu changes nothing at all ───────────────────────────── */
{
  // Classes 1–2, Science and English have no components. This is the whole of
  // "no agreed outcomes means the drill behaves exactly as before".
  assert.equal(renderSkillMenu([]), "", "nothing rendered, so nothing added to the prompt");
  assert.equal(skillAtRef([], 1), null);
  assert.deepEqual(refsForComponentIds([], ["c-a"]), []);
}

/* ── resolving what the model picked ────────────────────────────────── */
{
  const menu = buildSkillMenu(by([[1, "c-a", "Add within 20"], [2, "c-b", "Subtract within 20"]]), 2);

  assert.equal(skillAtRef(menu, 2)?.componentId, "c-b");
  // A number outside the menu is not a component. The model inventing a
  // reference must leave the question unattributed rather than attributed to
  // whatever happens to sit at that index.
  assert.equal(skillAtRef(menu, 0), null, "0 means the model set it from no listed idea");
  assert.equal(skillAtRef(menu, 3), null, "past the end");
  assert.equal(skillAtRef(menu, -1), null);
  assert.equal(skillAtRef(menu, 1.5), null);
  assert.equal(skillAtRef(menu, Number.NaN), null);
}

/* ── what has already been tested, by id not by sentence ────────────── */
{
  const menu = buildSkillMenu(by([[1, "c-a", "Add within 20"], [1, "c-b", "Count on from a number"]]), 1);

  assert.deepEqual(refsForComponentIds(menu, ["c-b", undefined, "c-b"]), [2], "deduped, blanks skipped");
  // The bug this guards: an id no longer on the menu — its outcome was
  // un-approved mid-session — must not resolve to a neighbouring line.
  assert.deepEqual(refsForComponentIds(menu, ["c-gone"]), [], "an id off the menu names nothing");
  assert.deepEqual(refsForComponentIds(menu, ["c-b", "c-a"]), [1, 2], "in menu order");
}

/* ── the prerequisite hint, and the rule it carries ─────────────────── */
{
  const line = foundationLine([
    "Understand a fraction as a number on the number line.",
    "Compare two fractions with the same numerator.",
    "Partition a whole into equal parts.",
  ]);
  assert.match(line, /number line/);
  assert.match(line, /same numerator/);
  assert.doesNotMatch(line, /Partition a whole/, "at most two — this is a foothold, not a syllabus");

  // THE RULE MOST WORTH PROTECTING: the foundation is context for an easier
  // question on the paper's own chapter, never a question from an earlier
  // class. The child sits this paper tomorrow.
  assert.match(line, /STAY ON THE CHAPTERS ABOVE/);

  assert.equal(foundationLine([]), "", "no prerequisites, no line");
  assert.equal(foundationLine(["   "]), "", "nor for blanks");
}

/* ── the rendered menu ──────────────────────────────────────────────── */
{
  const menu = buildSkillMenu(by([[4, "c-a", "Add within 20"], [7, "c-b", "Subtract within 20"]]), 7);
  const text = renderSkillMenu(menu);
  assert.match(text, /\[1\] \(chapter 4\) Add within 20/);
  assert.match(text, /\[2\] \(chapter 7\) Subtract within 20/);
  assert.match(text, /skillRef is 0/, "the model is told what to do with a chapter that has none");
}

console.log("  ok");
