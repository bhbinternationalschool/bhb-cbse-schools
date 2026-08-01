/**
 * Google Cloud Vision — TEXT_DETECTION (server-only).
 */

export function visionApiKey(): string {
  return (
    process.env.GOOGLE_VISION_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_CLOUD_API_KEY ||
    ""
  ).trim();
}

export function visionConfigured(): boolean {
  return visionApiKey().length > 0;
}

export async function visionExtractText(opts: {
  imageBase64: string;
  mimeType?: string;
}): Promise<
  | { ok: true; text: string }
  | { ok: false; error: string; mode: string }
> {
  const key = visionApiKey();
  if (!key) {
    return {
      ok: false,
      mode: "none",
      error:
        "Set GOOGLE_VISION_API_KEY or enable Vision API on GOOGLE_MAPS_API_KEY",
    };
  }

  const content = opts.imageBase64.replace(/^data:[^;]+;base64,/, "").trim();
  if (!content) {
    return { ok: false, mode: "none", error: "Empty image" };
  }

  const mime = (opts.mimeType || "image/jpeg").toLowerCase();
  if (mime === "application/pdf") {
    return {
      ok: false,
      mode: "vision",
      error: "PDF OCR needs a photo/scan image — export bill as JPG/PNG or photograph the page",
    };
  }

  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content },
            features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
          },
        ],
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      responses?: {
        fullTextAnnotation?: { text?: string };
        textAnnotations?: { description?: string }[];
        error?: { message?: string };
      }[];
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        ok: false,
        mode: "vision",
        error:
          json.error?.message ||
          json.responses?.[0]?.error?.message ||
          `Vision HTTP ${res.status}`,
      };
    }

    const block = json.responses?.[0];
    const text =
      block?.fullTextAnnotation?.text?.trim() ||
      block?.textAnnotations?.[0]?.description?.trim() ||
      "";

    if (!text) {
      return {
        ok: false,
        mode: "vision",
        error: "No text detected — use a clearer photo or better lighting",
      };
    }

    return { ok: true, text };
  } catch (e) {
    return {
      ok: false,
      mode: "vision",
      error: e instanceof Error ? e.message : "Vision request failed",
    };
  }
}
