"use client";

import { useEffect, useRef, useState } from "react";

const MAX_BYTES = 800_000;

type Props = {
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
  onError?: (message: string) => void;
  aspect?: "square" | "wide";
  hint?: string;
};

/** Photo or signature capture / upload (data URL stored on staff record). */
export function StaffImageField({
  label,
  value,
  onChange,
  onError,
  aspect = "square",
  hint = "Camera or file · under 800 KB",
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
      onError?.("Image must be under 800 KB");
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
      onError?.("Captured image is too large");
      return;
    }
    onChange(data);
    closeCam();
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
            {label}
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
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
            onClick={() => void openWebcam()}
          >
            Camera
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
            onClick={() => fileRef.current?.click()}
          >
            Upload
          </button>
          {value ? (
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--danger)]"
              onClick={() => onChange("")}
            >
              Remove
            </button>
          ) : null}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--muted)]">{hint}</p>
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
