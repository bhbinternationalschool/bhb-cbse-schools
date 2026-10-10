/**
 * Flatten a .docx into the two things a question-paper importer needs: the
 * text, one line per Word paragraph, and the pictures, each marked in the
 * text at the point it appeared.
 *
 * The papers we import are built out of nested tables — every question is
 * its own table, the number in one cell, the text in the next, the marks in
 * the last. Reading the table structure would mean modelling Word; reading
 * the paragraph stream gives exactly the same sequence of lines a person
 * sees, which is what the parser in `examPaperImport.ts` works from.
 *
 * Pictures matter as much as the text here — half of a Nursery paper is
 * pictures — so each one leaves a token like `[[img:rId27]]` in the line
 * where it sat, and the bytes come back beside it. A picture that cannot be
 * resolved to a file is dropped from the media list but its token stays, so
 * the loss is visible to the importer instead of silently changing a
 * question's meaning.
 *
 * Runs in the browser as well as on the server, because the import screen
 * reads every file for its preview before anything is uploaded.
 */

import { readZipEntries } from "@/lib/zipRead";

export type DocxImage = {
  /** Relationship id as it appears in the token, e.g. "rId27" */
  rid: string;
  /** File name inside the docx, e.g. "word/media/rId27.jpg" */
  name: string;
  extension: string;
  bytes: Uint8Array;
};

export type DocxDocument = {
  /** One entry per Word paragraph, trimmed; empty paragraphs are kept out. */
  lines: string[];
  images: DocxImage[];
};

export const IMAGE_TOKEN = /\[\[img:([A-Za-z0-9_.-]+)\]\]/g;

export function imageTokensIn(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(IMAGE_TOKEN)) out.push(m[1]!);
  return out;
}

export function stripImageTokens(line: string): string {
  return line.replace(IMAGE_TOKEN, " ").replace(/\s+/g, " ").trim();
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** rId -> target path, from word/_rels/document.xml.rels. */
function readRelationships(xml: string): Map<string, string> {
  const rels = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target) continue;
    rels.set(id, target.replace(/^\.?\//, ""));
  }
  return rels;
}

/**
 * Pull one paragraph's visible text, with a token where each picture sat.
 * Only `<w:t>` runs count as text: a paragraph's properties, bookmarks and
 * revision marks all carry attributes that would otherwise leak into the line.
 */
function paragraphText(xml: string): string {
  let out = "";
  const token = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<a:blip\b[^>]*\/>|<v:imagedata\b[^>]*\/>/g;
  for (const m of xml.matchAll(token)) {
    const frag = m[0];
    if (frag.startsWith("<w:t")) {
      out += decodeXmlText(m[1] ?? "");
    } else if (frag.startsWith("<w:tab") || frag.startsWith("<w:br")) {
      out += " ";
    } else {
      const rid =
        /\br:embed="([^"]+)"/.exec(frag)?.[1] ??
        /\br:link="([^"]+)"/.exec(frag)?.[1] ??
        /\br:id="([^"]+)"/.exec(frag)?.[1];
      if (rid) out += ` [[img:${rid}]] `;
    }
  }
  return out.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
}

/**
 * @returns null when the buffer is not a readable .docx — a caller must show
 *          that as a rejected file, never as an empty paper.
 */
export async function readDocx(bytes: Uint8Array): Promise<DocxDocument | null> {
  const entries = await readZipEntries(
    bytes,
    (n) =>
      n === "word/document.xml" ||
      n === "word/_rels/document.xml.rels" ||
      n.startsWith("word/media/"),
  );
  if (!entries) return null;

  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) return null;
  const decoder = new TextDecoder("utf-8");
  const xml = decoder.decode(doc.bytes);

  const relsPart = entries.find((e) => e.name === "word/_rels/document.xml.rels");
  const rels = relsPart
    ? readRelationships(decoder.decode(relsPart.bytes))
    : new Map<string, string>();

  const lines: string[] = [];
  for (const m of xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g)) {
    const line = paragraphText(m[0]);
    if (line) lines.push(line);
  }

  // Only the pictures actually referenced from the body — a header logo is
  // in word/media too, and it is not part of any question.
  const used = new Set<string>();
  for (const line of lines) for (const rid of imageTokensIn(line)) used.add(rid);

  const images: DocxImage[] = [];
  for (const rid of used) {
    const target = rels.get(rid);
    if (!target) continue;
    const name = target.startsWith("word/") ? target : `word/${target}`;
    const entry = entries.find((e) => e.name === name);
    if (!entry) continue;
    const extension = (name.split(".").pop() || "").toLowerCase();
    images.push({ rid, name, extension, bytes: entry.bytes });
  }

  return { lines, images };
}
