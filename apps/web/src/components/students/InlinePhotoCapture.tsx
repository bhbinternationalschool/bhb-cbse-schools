"use client";

import { useEffect, useRef, useState } from "react";

const MAX_BYTES = 800_000;

type Props = {
  photoUrl: string;
  label?: string;
  onChange: (photoUrl: string) => void;
  onError?: (message: string) => void;
  size?: number;
};

/**
 * Compact upload / camera control for roster rows (student or parent photos).
 */
export function InlinePhotoCapture({
  photoUrl,
  label,
  onChange,
  onError,
  size = 48,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOpen, setCamOpen] = useState(false);

  function acceptFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError?.("Choose an image file");
      return;
    }
    if (file.size > MAX_BYTES) {
      onError?.("Photo must be under 800 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onChange(reader.result);
    };
    reader.readAsDataURL(file);
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
    let quality = 0.85;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > MAX_BYTES * 1.37 && quality > 0.4) {
      quality -= 0.1;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    if (data.length > MAX_BYTES * 1.37) {
      onError?.("Captured photo is too large");
      return;
    }
    onChange(data);
    closeCam();
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {label ? (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          {label}
        </span>
      ) : null}
      <div className="flex items-center gap-2">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={label ? `${label} preview` : "Student photo preview"}
            width={size}
            height={size}
            className="shrink-0 rounded-full object-cover ring-1 ring-[rgba(32,48,80,0.12)]"
            style={{ width: size, height: size }}
          />
        ) : (
          <span
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-[rgba(32,48,80,0.08)] text-[10px] font-semibold text-[var(--muted)]"
            style={{ width: size, height: size }}
          >
            —
          </span>
        )}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="rounded-md bg-[var(--brand-deep)] px-2 py-1 text-[10px] font-bold text-white"
            onClick={() => void openWebcam()}
          >
            Camera
          </button>
          <button
            type="button"
            className="rounded-md border border-[rgba(32,48,80,0.2)] bg-white px-2 py-1 text-[10px] font-bold text-[var(--brand-deep)]"
            onClick={() => fileRef.current?.click()}
          >
            Upload
          </button>
          {photoUrl ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[10px] font-semibold text-[#b71c1c]"
              onClick={() => onChange("")}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
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

      {camOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(32,48,80,0.72)] p-4"
          role="dialog"
          aria-modal="true"
          aria-label={label ? `Take ${label} photo` : "Take photo"}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-lg">
            <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
              Camera{label ? ` · ${label}` : ""}
            </div>
            <div className="bg-[var(--brand-deep)]">
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-[4/3] w-full object-cover"
              />
            </div>
            <div className="flex gap-2 p-4">
              <button
                type="button"
                className="rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                onClick={closeCam}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
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
