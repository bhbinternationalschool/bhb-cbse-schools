/**
 * The agreed micro-skills a revision question may be set from, and the idea
 * underneath one the child got wrong.
 *
 * WHAT THIS IS FOR. Until now the drill was told the chapter names and their
 * topics and left to invent what to test. Two things follow from that, and
 * both were visible in real sessions: the same idea comes back under two
 * names ("unitary method" one question, "value of one" the next, so
 * `avoidSkills` never sees a repeat), and what a question tests is the
 * model's idea of the chapter rather than the school's.
 *
 * A chapter whose outcomes a teacher has AGREED WITH (Teaching → Learning
 * outcomes) carries CASE components — the micro-skills the standard breaks
 * into. Those are a fixed vocabulary. This module turns them into a numbered
 * menu for the prompt and turns the number the model picks back into the
 * component it names, so "which idea was tested" is a stored id rather than
 * a sentence to be matched later by hand.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP:
 *
 *   1. NOTHING HERE MAY WIDEN THE DRILL. The menu only ever narrows what to
 *      ask about; a chapter with no agreed outcomes gets no menu and the
 *      drill behaves exactly as it did before this file existed. Classes 1–2,
 *      Science and English have no components at all, so for them this is a
 *      no-op by construction, not by remembering to check.
 *
 *   2. A RETRY STAYS ON THE PAPER'S CHAPTER. The prerequisite walk says what
 *      is probably missing underneath; it does not move the question to an
 *      earlier class. The child sits this paper tomorrow, and the drill's
 *      first rule is that nothing is asked from outside what they have been
 *      taught. The foundation is given to the model as context for an EASIER
 *      question on the same chapter — never as the new subject of one.
 */

/** One micro-skill of one chapter, as the menu holds it. */
export type AgreedSkill = {
  /** CASE component uuid — what gets stored on the asked question. */
  componentId: string;
  /** The chapter of the child's own book it belongs to. */
  position: number;
  /** The component's own sentence. */
  description: string;
};

/** As the loader returns them, before scope and the caps are applied. */
export type SkillsByPosition = Map<number, { componentId: string; description: string }[]>;

/**
 * How much of the menu reaches the prompt.
 *
 * The chapter list is already in the prompt; this sits under it. A Class 6
 * paper covering twelve chapters would otherwise put sixty sentences in front
 * of a model asked for one question, and the cost is not the tokens — it is
 * that a long menu is skimmed. Three per chapter keeps a chapter's breadth
 * (the reason `avoidSkills` exists at all) without any one chapter crowding
 * out the rest.
 */
export const MENU_PER_CHAPTER = 3;
export const MENU_TOTAL = 30;

/**
 * The numbered menu, in a fixed order.
 *
 * ORDER MATTERS AND IS NOT COSMETIC. The number the model returns is resolved
 * against this menu on the same turn, but a session spans turns, and
 * `avoidRefs` renumbers a component asked three questions ago. Sorting by
 * chapter and then by the sentence itself makes the menu a function of the
 * data and the scope alone — the same two inputs on every turn of a session —
 * so a number means the same thing all the way through.
 */
export function buildSkillMenu(
  byPosition: SkillsByPosition,
  scope: number,
  opts?: { perChapter?: number; total?: number },
): AgreedSkill[] {
  const perChapter = opts?.perChapter ?? MENU_PER_CHAPTER;
  const total = opts?.total ?? MENU_TOTAL;
  if (!(scope >= 1) || perChapter < 1 || total < 1) return [];

  const positions = [...byPosition.keys()].filter((p) => p >= 1 && p <= scope).sort((a, b) => a - b);
  const out: AgreedSkill[] = [];
  for (const position of positions) {
    const rows = (byPosition.get(position) ?? [])
      .filter((r) => r.componentId && r.description.trim())
      .sort((a, b) => a.description.localeCompare(b.description) || a.componentId.localeCompare(b.componentId))
      .slice(0, perChapter);
    for (const r of rows) {
      if (out.length >= total) return out;
      out.push({ componentId: r.componentId, position, description: r.description.trim() });
    }
  }
  return out;
}

/**
 * The menu as the prompt reads it, or "" when there is nothing agreed.
 *
 * Empty is the common case and must stay cheap: the caller pushes nothing,
 * the prompt is the one it was before, and the model is not told about a
 * menu it has not been given.
 */
export function renderSkillMenu(menu: AgreedSkill[]): string {
  if (!menu.length) return "";
  return [
    "Ideas from these chapters that this school has agreed are worth testing.",
    'Set the question from ONE of them when the chapter you pick has any listed, and put its number in "skillRef". A chapter with none listed is still fair to ask from — then skillRef is 0.',
    ...menu.map((s, i) => `  [${i + 1}] (chapter ${s.position}) ${s.description}`),
  ].join("\n");
}

/** The component a returned `skillRef` names, or null for 0 / out of range. */
export function skillAtRef(menu: AgreedSkill[], ref: number): AgreedSkill | null {
  if (!Number.isInteger(ref) || ref < 1 || ref > menu.length) return null;
  return menu[ref - 1] ?? null;
}

/**
 * The menu numbers of components already tested this session.
 *
 * Resolved from stored ids rather than carried in the session, so a component
 * that has since dropped out of the menu — the teacher un-approved its
 * outcome mid-session — simply stops being mentioned instead of pointing the
 * model at the wrong line.
 */
export function refsForComponentIds(menu: AgreedSkill[], componentIds: (string | undefined)[]): number[] {
  const index = new Map(menu.map((s, i) => [s.componentId, i + 1]));
  const out: number[] = [];
  for (const id of componentIds) {
    if (!id) continue;
    const ref = index.get(id);
    if (ref && !out.includes(ref)) out.push(ref);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The line that hands the model what is probably missing underneath.
 *
 * At most two: this is a hint about where the gap is, and a list of five
 * earlier standards reads as a syllabus to teach rather than a foothold. The
 * wording carries rule 2 from the top of this file INTO THE PROMPT, because
 * the model is the thing that would otherwise drop the child two classes.
 */
export function foundationLine(statements: string[], max = 2): string {
  const picked = statements.map((s) => s.trim()).filter(Boolean).slice(0, Math.max(1, max));
  if (!picked.length) return "";
  return [
    "What usually sits underneath that idea, and may be what they are actually missing:",
    ...picked.map((s) => `  - ${s}`),
    "Use this to judge where the easier question should start. STAY ON THE CHAPTERS ABOVE — do not set a question from an earlier class; ask the same chapter's idea in its simplest form, in the way that foundation would be used.",
  ].join("\n");
}
