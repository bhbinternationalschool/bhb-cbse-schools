"use client";

import { useEffect, useRef, useState } from "react";
import { acceptFor, bucketFor, type MediaVisibility } from "@/lib/media";
import { uploadMedia } from "@/lib/mediaUpload";

type Props = {
  label: string;
  /** The stored URL. Legacy records may still hold a data: URL; those render. */
  value: string;
  onChange: (url: string) => void;
  onError?: (message: string) => void;
  aspect?: "square" | "wide";
  hint?: string;
  /**
   * Who may fetch the result. `public` puts it in the website bucket — right
   * for the crest and the favicon, wrong for a signature or a face.
   */
  visibility: MediaVisibility;
  /** Folder in the bucket, e.g. `brand` or `staff/BHB001`. */
  pathPrefix: string;
};

/**
 * Pick or capture an image, store it, and keep the URL.
 *
 * This used to hand `onChange` a base64 `data:` URL — the file itself, capped
 * at 800 KB, written into whatever record the form saved. That is why the
 * storage bucket held nothing and the school's favicon lives in the masters
 * row as 45 kB of text. It now uploads, and an upload that fails says so
 * instead of quietly succeeding with the picture in place of a link.
 */
export function StaffImageField({
  label,
  value,
  onChange,
  onError,
  aspect = "square",
  hint,
  visibility,
  pathPrefix,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const bucket = bucketFor(visibility);
  const defaultHint =
    visibility === "public"
      ? "Camera or file · published on the website"
      : "Camera or file · visible to staff only";

  async function store(file: File, alreadySized = false) {
    setBusy(true);
    try {
      const res = await uploadMedia({
        file,
        visibility,
        pathPrefix,
        verbatim: alreadySized,
      });
      if (!res.ok) {
        onError?.(res.error);
        return;
      }
      onChange(res.url);
    } finally {
      setBusy(false);
    }
  }

  function acceptFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError?.("Choose an image file");
      return;
    }
    void store(file);
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function openWebcam() {
    const isCoarse =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (isCoarse && cameraRef.current) {
      cameraRef.current.click();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setCamOpen(true);
    } catch {
      cameraRef.current?.click();
    }
  }

  useEffect(() => {
    if (!camOpen || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play();
  }, [camOpen]);

  useEffect(() => () => stopStream(), []);

  function closeCam() {
    stopStream();
    setCamOpen(false);
  }

  function snapPhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    closeCam();
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          onError?.("Could not read the camera image");
          return;
        }
        void store(
          new File([blob], `${label.toLowerCase().replace(/\W+/g, "-")}.jpg`, {
            type: "image/jpeg",
          }),
          true,
        );
      },
      "image/jpeg",
      0.85,
    );
  }

  const box =
    aspect === "wide"
      ? "h-20 w-44 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-sunken)]"
      : "h-24 w-24 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-sunken)]";

  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className={`${box} overflow-hidden`}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {busy ? "Saving…" : label}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-[var(--brand-deep)]">
          {label}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            disabled={busy}
            onClick={() => void openWebcam()}
          >
            Camera
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-60"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
          {value && !busy ? (
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--danger)]"
              onClick={() => onChange("")}
            >
              Remove
            </button>
          ) : null}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--muted)]">
          {hint ?? defaultHint}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept={acceptFor(bucket, "image")}
          className="hidden"
          onChange={(e) => {
            acceptFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(e) => {
            acceptFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>

      {camOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Capture ${label}`}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-[var(--card)] shadow-lg">
            <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
              Camera · {label}
            </div>
            <div className="bg-[var(--brand-deep)]">
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-video w-full object-cover"
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--muted)]"
                onClick={closeCam}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
                onClick={snapPhoto}
              >
                Capture
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
