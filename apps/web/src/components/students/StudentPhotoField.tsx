"use client";

import { useEffect, useRef, useState } from "react";
import { StudentAvatar } from "@/components/students/StudentAvatar";

const MAX_BYTES = 800_000;

type Props = {
  fullName: string;
  photoUrl: string;
  onChange: (photoUrl: string) => void;
  onError?: (message: string) => void;
};

/**
 * Student photo: camera capture (phone camera / desktop webcam) + file choose.
 */
export function StudentPhotoField({
  fullName,
  photoUrl,
  onChange,
  onError,
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
    // Prefer native camera sheet on phones; desktop gets live webcam.
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
      // Fallback: native capture / file
      cameraRef.current?.click();
    }
  }

  useEffect(() => {
    if (!camOpen || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play();
  }, [camOpen]);

  useEffect(() => {
    return () => stopStream();
  }, []);

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
    // Compress JPEG to stay under size cap
    let quality = 0.85;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > MAX_BYTES * 1.37 && quality > 0.4) {
      quality -= 0.1;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    if (data.length > MAX_BYTES * 1.37) {
      onError?.("Captured photo is too large — try again closer / lower light");
      return;
    }
    onChange(data);
    closeCam();
  }

  return (
    <div className="mt-3 flex flex-wrap items-start gap-3">
      <StudentAvatar
        student={{ fullName: fullName || "Student", photoUrl }}
        size={56}
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-sm text-[var(--muted)]">Photo</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
            onClick={() => void openWebcam()}
          >
            Take photo
          </button>
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
            onClick={() => fileRef.current?.click()}
          >
            Choose file
          </button>
          {photoUrl ? (
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--danger)]"
              onClick={() => onChange("")}
            >
              Remove
            </button>
          ) : null}
        </div>

        {/* Hidden: gallery / files (no capture) */}
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
        {/* Hidden: native camera on phones */}
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

        <p className="mt-1.5 text-[11px] text-[var(--muted)]">
          Optional · camera or file · under 800 KB · else initials
        </p>
      </div>

      {camOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(32,48,80,0.72)] p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Take student photo"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-lg">
            <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
              Camera
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
