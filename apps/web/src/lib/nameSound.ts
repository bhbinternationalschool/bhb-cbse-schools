/**
 * Names as they sound, so one typed in Hindi finds the one stored in English.
 *
 * WHY (21 Sep 2026): staff type a child's name the way they would say it —
 * "वैभव पांडे का कितना फीस बकाया है?" — and the roster holds "Vaibhav
 * Pandey". Nothing matched, so the desk said it could not find the child.
 * The same name also turns up spelt three ways in Latin (Pandey / Pande,
 * Sidharth / Siddharth, Pooja / Puja), so both sides are folded to one key
 * before they are compared.
 *
 * Pure, no dependencies. Not a transliteration anyone should print — only a
 * comparison key.
 */

const VOWELS: Record<string, string> = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri",
  "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e",
};

const MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e",
};

const CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f", "य़": "y",
};

/** With a nukta (़) the base letter changes sound: ज़ is z, फ़ is f. */
const NUKTA: Record<string, string> = {
  "क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f", "य": "y",
};

const VIRAMA = "्";
const NUKTA_SIGN = "़";

export function hasDevanagari(s: string): boolean {
  return /[ऀ-ॿ]/.test(s || "");
}

/**
 * Devanagari to plain Latin letters, the way the name would be typed in
 * English: every consonant carries its "a" unless a vowel sign or a virama
 * replaces it, and the "a" at the end of a word is not said (राम is "raam",
 * not "raama"). Anything that is not Devanagari passes through unchanged.
 */
export function devanagariToLatin(s: string): string {
  const chars = [...(s || "")];
  let out = "";
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i]!;
    let base = CONSONANTS[c];
    if (base !== undefined) {
      if (chars[i + 1] === NUKTA_SIGN) {
        base = NUKTA[c] ?? base;
        i += 1;
      }
      const next = chars[i + 1];
      if (next === VIRAMA) {
        out += base;
        i += 1;
      } else if (next && MATRAS[next] !== undefined) {
        out += base + MATRAS[next];
        i += 1;
      } else {
        // The inherent vowel — dropped at the end of a word.
        const endOfWord = !next || !/[ऀ-ॿ]/.test(next) || next === " ";
        out += endOfWord && out.length > 0 && !/\s$/.test(out) ? base : `${base}a`;
      }
      continue;
    }
    if (VOWELS[c] !== undefined) {
      out += VOWELS[c];
      continue;
    }
    if (MATRAS[c] !== undefined) {
      out += MATRAS[c];
      continue;
    }
    if (c === "ं" || c === "ँ") {
      out += "n";
      continue;
    }
    if (c === "ः") {
      out += "h";
      continue;
    }
    if (c === VIRAMA || c === NUKTA_SIGN || c === "ऽ") continue;
    if (c === "।" || c === "॥") {
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * One word folded to how it sounds, for comparing names only.
 *
 * Spellings that people use interchangeably collapse to one key:
 * long vowels (aa/a, ee/i, oo/u), the h of an aspirate (Sidharth /
 * Siddharth / Sidhart), w/v, ph/f, z/j, doubled letters, a final "ey"
 * (Pandey / Pande), Singh / सिंह, and the final "a" that Hindi does not say (Krishna /
 * कृष्ण, Shreya / श्रेया).
 */
export function nameSoundKey(word: string): string {
  let w = devanagariToLatin((word || "").toLowerCase()).replace(/[^a-z]/g, "");
  if (!w) return "";
  w = w
    .replace(/ph/g, "f")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/m(?=[bp])/g, "n")
    // the h of an aspirate or of sh/ch: after any consonant
    .replace(/([bcdfgjklmnprstv])h/g, "$1")
    .replace(/aa+/g, "a")
    .replace(/ee+|ii+/g, "i")
    .replace(/oo+|uu+/g, "u")
    .replace(/ey$/, "e")
    // Singh / सिंह: the anusvara is said as n, and the g is not written
    .replace(/ng$/, "n")
    .replace(/(.)\1+/g, "$1");
  if (w.length > 2) w = w.replace(/a$/, "");
  return w;
}
