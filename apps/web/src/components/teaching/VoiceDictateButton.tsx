"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import {
  browserSpeechRecognitionSupported,
  startVoiceListen,
  stopVoiceListen,
  transcribeAudioBlob,
} from "@/lib/voiceClient";

type VoiceLang = "hi-IN" | "en-IN" | "auto";

/**
 * Mic button that appends dictated text to a field.
 *
 * Two paths, in order of preference:
 *  1. The browser's own recognition (Chrome) — instant, free, no upload.
 *  2. Recording the microphone and sending it to /api/voice/transcribe
 *     (Google STT) — used where the browser has no recognition, e.g.
 *     Safari and most in-app webviews.
 *
 * Dictation always *appends*: a teacher adding a second sentence must
 * never silently wipe what they already typed.
 */
export function VoiceDictateButton({
  onText,
  lang = "auto",
  title = "Dictate",
}: {
  onText: (text: string) => void;
  lang?: VoiceLang;
  title?: string;
}) {
  const [state, setState] = useState<"idle" | "listening" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setSupported(
      browserSpeechRecognitionSupported() ||
        (typeof navigator !== "undefined" &&
          !!navigator.mediaDevices?.getUserMedia),
    );
    return () => {
      stopVoiceListen();
      try {
        recorderRef.current?.stop();
      } catch {
        /* already stopped */
      }
    };
  }, []);

  async function startRecordingFallback() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        // Release the mic as soon as we stop; leaving it open keeps the
        // browser's recording indicator on and drains battery.
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        if (blob.size === 0) {
          setState("idle");
          return;
        }
        setState("working");
        const result = await transcribeAudioBlob(
          blob,
          lang === "auto" ? "hi-IN" : lang,
        );
        setState("idle");
        if (result.ok && result.text) onText(result.text);
        else setError(result.error || "Could not hear you");
      };
      recorder.start();
      setState("listening");
    } catch {
      setError("Microphone blocked — allow access and try again");
      setState("idle");
    }
  }

  function start() {
    setError(null);
    if (browserSpeechRecognitionSupported()) {
      const ok = startVoiceListen({
        lang,
        onFinal: (text) => {
          if (text.trim()) onText(text.trim());
          setState("idle");
        },
        onError: (msg) => {
          setError(msg);
          setState("idle");
        },
      });
      if (ok) setState("listening");
      return;
    }
    void startRecordingFallback();
  }

  function stop() {
    if (browserSpeechRecognitionSupported()) {
      stopVoiceListen();
      setState("idle");
      return;
    }
    try {
      recorderRef.current?.stop();
    } catch {
      setState("idle");
    }
  }

  // Hidden entirely where neither path exists, rather than showing a
  // button that cannot work.
  if (supported === false) return null;

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={state === "listening" ? stop : start}
        disabled={state === "working"}
        title={state === "listening" ? "Stop dictation" : title}
        aria-label={state === "listening" ? "Stop dictation" : title}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
          state === "listening"
            ? "animate-pulse border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
            : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--brand-deep)]"
        }`}
      >
        {state === "working" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === "listening" ? (
          <Square className="h-3 w-3" />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
      </button>
      {error ? (
        <span className="text-[10px] text-[var(--danger)]">{error}</span>
      ) : state === "listening" ? (
        <span className="text-[10px] text-[var(--muted)]">listening…</span>
      ) : null}
    </span>
  );
}
