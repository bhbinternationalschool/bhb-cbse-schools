/**
 * What a parent's document upload has to be before the school keeps it.
 *
 * Pure and dependency-free so it can be tested with hand-built bytes. The
 * declared MIME type is not trusted: the bytes are sniffed, and a mismatch
 * is refused — a renamed file is the commonest way a wrong upload happens.
 * Images must be big enough to read; a 90-pixel thumbnail of a birth
 * certificate helps nobody, least of all the clerk who has to verify it.
 */
export type SniffedKind = "jpg" | "png" | "webp" | "pdf";

export type UploadCheck =
  | { ok: true; kind: SniffedKind; mimeType: string; width: number | null; height: number | null }
  | { ok: false; error: string };

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

/** Shortest side an identity document image must have to be legible. */
export const MIN_DOCUMENT_EDGE_PX = 300;
/** A passport photo can be smaller and still be a face. */
export const MIN_PHOTO_EDGE_PX = 200;

const MIME_OF: Record<SniffedKind, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

export function sniffKind(b: Uint8Array): SniffedKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "webp";
  }
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return "pdf";
  }
  return null;
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
}
function u24le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
}

/** Pixel size of a JPEG, PNG or WebP; null when the header is not readable. */
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  const kind = sniffKind(b);
  if (kind === "png") {
    if (b.length < 24) return null;
    return { width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (kind === "jpg") {
    // Walk the segments to the first SOFn marker, which carries the size.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  if (kind === "webp") {
    if (b.length < 30) return null;
    const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (chunk === "VP8X") {
      return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    }
    if (chunk === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 ") {
      return { width: u16be(b, 27) & 0x3fff ? (b[26]! | (b[27]! << 8)) & 0x3fff : 0, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    }
    return null;
  }
  return null;
}

export function checkDocumentUpload(input: {
  bytes: Uint8Array;
  declaredMime: string;
  /** "photo" has its own size rule and must be an image. */
  docKey: string;
}): UploadCheck {
  const { bytes } = input;
  if (bytes.length === 0) return { ok: false, error: "The file is empty" };
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: `The file is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB` };
  }
  const kind = sniffKind(bytes);
  if (!kind) {
    return { ok: false, error: "Use a photo (JPG, PNG or WebP) or a PDF" };
  }
  const declared = input.declaredMime.toLowerCase().trim();
  if (declared && declared !== MIME_OF[kind] && !(kind === "jpg" && declared === "image/jpg")) {
    return {
      ok: false,
      error: `The file says it is ${declared} but its contents are ${MIME_OF[kind]} — upload the original file`,
    };
  }
  if (input.docKey === "photo" && kind === "pdf") {
    return { ok: false, error: "The passport photo must be an image, not a PDF" };
  }
  if (kind === "pdf") {
    return { ok: true, kind, mimeType: MIME_OF[kind], width: null, height: null };
  }
  const dims = imageDimensions(bytes);
  if (!dims || dims.width <= 0 || dims.height <= 0) {
    return { ok: false, error: "The image could not be read — try another photo" };
  }
  const minEdge = input.docKey === "photo" ? MIN_PHOTO_EDGE_PX : MIN_DOCUMENT_EDGE_PX;
  if (Math.min(dims.width, dims.height) < minEdge) {
    return {
      ok: false,
      error: `The image is too small to read (${dims.width}×${dims.height}). Take a closer, clearer photo`,
    };
  }
  return { ok: true, kind, mimeType: MIME_OF[kind], width: dims.width, height: dims.height };
}
