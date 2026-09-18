/**
 * The smallest ZIP reader that can open a .docx — and it runs in both places.
 *
 * A Word file is a ZIP of XML parts, and the only thing we need from it is
 * `word/document.xml` plus whatever sits under `word/media/`. Pulling in a zip
 * library for that would add a dependency for one import screen.
 *
 * It matters that this works in the browser as well as on the server: the
 * Question Papers import shows the school a table of every file it found and
 * what it makes of it *before* anything is uploaded. That preview reads 88
 * Word files; doing it in the browser means the preview costs no upload at
 * all, and only the papers the school approves are ever sent. So the
 * inflating is done with `DecompressionStream`, which both runtimes have,
 * rather than `node:zlib`.
 */

export type ZipEntry = {
  name: string;
  bytes: Uint8Array;
};

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;

async function inflateRaw(raw: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([raw as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * The end-of-central-directory record lives at the very end of the file,
 * behind a comment of unknown length — so it is found by scanning backwards
 * for its signature rather than by arithmetic.
 */
function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 0xffff - 22);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

type Directory = { offset: number; count: number };

function readDirectory(view: DataView): Directory | null {
  const eocd = findEocd(view);
  if (eocd < 0) return null;

  let count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  // A zip64 file parks 0xffff / 0xffffffff in those fields and keeps the real
  // numbers in its own record. One paper is not that large, but a folder-wide
  // zip of every paper is, and a silently truncated entry list would drop
  // files without saying so.
  if (count === 0xffff || offset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && view.getUint32(loc, true) === SIG_EOCD64_LOCATOR) {
      const z64 = Number(view.getBigUint64(loc + 8, true));
      if (
        z64 >= 0 &&
        z64 + 56 <= view.byteLength &&
        view.getUint32(z64, true) === SIG_EOCD64
      ) {
        count = Number(view.getBigUint64(z64 + 32, true));
        offset = Number(view.getBigUint64(z64 + 48, true));
      }
    }
  }
  return { offset, count };
}

const decoder = new TextDecoder("utf-8");

/**
 * Read the entries of a ZIP. `wanted` keeps the reader from inflating parts
 * nobody asked for — a paper's `word/theme/` and `fontTable.xml` are dead
 * weight across 88 files.
 *
 * Returns null when the buffer is not a ZIP at all; an entry that fails to
 * inflate is left out rather than returned empty, so a caller never mistakes
 * a broken part for an empty one.
 */
export async function readZipEntries(
  bytes: Uint8Array,
  wanted?: (name: string) => boolean,
): Promise<ZipEntry[] | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dir = readDirectory(view);
  if (!dir) return null;

  const out: ZipEntry[] = [];
  let p = dir.offset;
  for (let i = 0; i < dir.count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    if (wanted && !wanted(name)) continue;

    // The local header repeats the name and extra field, and its extra field
    // length may differ from the central one — so it must be read, not assumed.
    if (localOffset + 30 > bytes.length) continue;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const end = start + compressedSize;
    if (end > bytes.length) continue;

    const raw = bytes.subarray(start, end);
    if (method === 0) {
      out.push({ name, bytes: raw });
      continue;
    }
    if (method !== 8) continue;
    const inflated = await inflateRaw(raw);
    if (!inflated) continue;
    out.push({ name, bytes: inflated });
  }
  return out;
}
