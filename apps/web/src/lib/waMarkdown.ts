/**
 * Markdown out, WhatsApp in.
 *
 * WHY (22 Sep 2026): the AI tutor writes Markdown, because that is what
 * models write. WhatsApp does not read Markdown — it has its own, older
 * formatting, where bold is ONE asterisk. So everything the model emphasised
 * arrived at the family as punctuation. MANMOHAN DIXIT, practising Hindi
 * rhymes with SHANVI the night before her UKG paper, was sent:
 *
 *   शाबाश शानवी! आपका उत्तर **बिल्कुल सही** है!
 *   **कारण:** कविता की सही पंक्ति है — "मछली जल की **रानी** है ..."
 *   ---
 *   ### कल के अर्धवार्षिक पेपर के लिए मुख्य बातें (Exam Preparation Tips):
 *   **1. दोहराने के लिए मुख्य बातें (Key Points to Revise):**
 *   * मुख्य कविताओं की पंक्तियाँ याद रखें ...
 *
 * Every asterisk, hash and dash in that is visible on the parent's phone.
 * The praise a five-year-old's mother is meant to read aloud is buried in
 * markup.
 *
 * The conversion is deliberately small. It moves only what WhatsApp has an
 * equivalent for, and leaves everything else exactly as the model wrote it —
 * a tutor's reply is full of maths, and a converter that gets clever about
 * asterisks will eat a multiplication sign.
 */

/** A line that is only a rule: --- , *** , ___ . Markdown's, not the text's. */
const RULE_LINE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/** "### Heading", up to three leading spaces, trailing hashes optional. */
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

/**
 * "* item" / "+ item" at the start of a line.
 *
 * "-" is left alone on purpose: a dash bullet already reads as a bullet on a
 * phone, and a line may legitimately open with a minus sign.
 */
const STAR_BULLET = /^(\s*)[*+][ \t]+/;

/**
 * "**bold**" → "*bold*", within one line.
 *
 * Bounded to a single line so an unclosed "**" cannot swallow the rest of
 * the message, and non-greedy so two bold runs on one line stay two.
 */
const DOUBLE_STAR = /\*\*([^\n]+?)\*\*/g;

/** "__underline__" → "_italic_", the same way and for the same reason. */
const DOUBLE_UNDERSCORE = /__([^\n]+?)__/g;

/**
 * The model's Markdown as WhatsApp will actually show it.
 *
 * Safe on text that contains no Markdown at all — every rule needs its
 * marker, so a plain reply comes back unchanged.
 */
export function whatsappFromMarkdown(text: string): string {
  const src = String(text ?? "");
  if (!src.trim()) return src;

  const out: string[] = [];
  for (const raw of src.split("\n")) {
    if (RULE_LINE.test(raw)) {
      // A rule is a divider the phone cannot draw. Drop it and let the blank
      // line around it do the same job.
      continue;
    }
    let line = raw;
    const heading = HEADING.exec(line);
    // A heading becomes a bold line — the nearest thing WhatsApp has.
    if (heading) line = `*${heading[1]!}*`;
    else line = line.replace(STAR_BULLET, "$1• ");
    line = line.replace(DOUBLE_STAR, "*$1*").replace(DOUBLE_UNDERSCORE, "_$1_");
    out.push(line);
  }

  return out
    .join("\n")
    // Dropping a rule leaves the blank line above and below it; three or more
    // in a row is a gap on the phone, not a paragraph break.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
