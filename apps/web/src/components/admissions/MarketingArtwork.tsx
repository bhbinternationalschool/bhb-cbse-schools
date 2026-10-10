"use client";

/**
 * Admissions → Marketing → artwork.
 *
 * The copy generator above this card writes the words. This writes the
 * picture behind them, on Puter's free image service (see lib/puterAi.ts for
 * why that is allowed here and almost nowhere else: staff-only, no student
 * data, and a paid path is never being replaced — there is no paid path,
 * the office used to have no artwork at all).
 *
 * Two things are deliberate and are not settings:
 *
 *  - **The picture never carries words.** Image models render text as
 *    convincing nonsense, and a poster that invents a result percentage or
 *    a fee is a CBSE/ASCI problem rather than a typo. The prompt forbids
 *    text, and the office lays the ERP's own accepted copy over the image.
 *  - **The picture never shows a recognisable child.** A generated face is
 *    a consent question nobody can answer, so the prompt asks for children
 *    from behind, at a distance, or in silhouette.
 *
 * Nothing is saved anywhere: the image lives in this tab until it is
 * downloaded. That keeps a draft that was never approved out of the ERP.
 */

import { useState } from "react";
import { Download, ImageIcon, Loader2, RefreshCw } from "lucide-react";
import {
  POSTER_MOODS,
  POSTER_STYLES,
  buildPosterPrompt,
  puterEnabled,
  type PosterMood,
  type PosterStyle,
} from "@/lib/puterAi";
import { puterGenerateImage } from "@/lib/puterAi.client";

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";

export function MarketingArtwork({
  canEdit,
  defaultOccasion,
}: {
  canEdit: boolean;
  /** The occasion already typed into the copy generator, so it is not retyped. */
  defaultOccasion?: string;
}) {
  const [occasion, setOccasion] = useState("");
  const [subject, setSubject] = useState("");
  const [mood, setMood] = useState<PosterMood>("warm");
  const [style, setStyle] = useState<PosterStyle>("illustration");
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The school has not switched the free service on — the card would only
  // be a button that cannot work, so it is not shown at all.
  if (!puterEnabled()) return null;

  // The generator's own occasion is the sensible default, but the moment
  // the office types its own it wins.
  const effectiveOccasion = occasion.trim() || (defaultOccasion || "").trim();

  async function generate() {
    setError(null);
    setBusy(true);
    try {
      const prompt = buildPosterPrompt({
        occasion: effectiveOccasion,
        subject,
        mood,
        style,
      });
      const res = await puterGenerateImage(prompt);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setImage(res.dataUrl);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image;
    a.download = `artwork-${(effectiveOccasion || "school").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "school"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ImageIcon className="h-4 w-4 text-[var(--muted)]" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Artwork for the post</p>
          <p className="text-[11px] text-[var(--muted)]">
            Free picture service, run in this browser. The picture is drawn
            without any words, logos or close-up faces — put the accepted
            copy above over it yourself. Nothing is saved until you download.
          </p>
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <label className="text-[11px] text-[var(--muted)] sm:col-span-2">
          Occasion
          <input
            className={`${inp} mt-0.5`}
            maxLength={120}
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            placeholder={defaultOccasion || "Open house · Annual day · Diwali"}
          />
        </label>
        <label className="text-[11px] text-[var(--muted)] sm:col-span-2">
          What should the picture show?
          <input
            className={`${inp} mt-0.5`}
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="children planting saplings in the school ground"
          />
        </label>
        <label className="text-[11px] text-[var(--muted)]">
          Mood
          <select className={`${inp} mt-0.5`} value={mood} onChange={(e) => setMood(e.target.value as PosterMood)}>
            {POSTER_MOODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-[var(--muted)]">
          Style
          <select className={`${inp} mt-0.5`} value={style} onChange={(e) => setStyle(e.target.value as PosterStyle)}>
            {POSTER_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !canEdit || (!effectiveOccasion && !subject.trim())}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          onClick={() => void generate()}
          title={canEdit ? "" : "You do not have permission to use this"}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
          {busy ? "Drawing…" : image ? "Draw again" : "Draw a picture"}
        </button>
        {image ? (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
              onClick={download}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]"
              onClick={() => setImage(null)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Clear
            </button>
          </>
        ) : null}
        <span className="text-[11px] text-[var(--muted)]">
          The first picture of a session may ask you to sign in to the free
          service — close it and nothing is lost.
        </span>
      </div>

      {error ? (
        <p className="mt-2 text-[11px] font-semibold text-[var(--warning)]">{error}</p>
      ) : null}

      {image ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-[var(--border)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={`Generated artwork for ${effectiveOccasion || "the school"}`}
            className="max-h-96 w-full object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}
