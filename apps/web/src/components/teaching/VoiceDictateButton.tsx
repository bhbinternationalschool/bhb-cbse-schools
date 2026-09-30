"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, Square } from "lucide-react";
import {
  browserSpeechRecognitionSupported,
  recordingToWav,
  startVoiceListen,
  stopVoiceListen,
  transcribeAudioBlob,
} from "@/lib/voiceClient";
import {
  MAX_DICTATION_MS,
  appendDictation,
  formatDictationClock,
  needsWavConversion,
  pickRecorderMime,
  speechErrorMeansUseRecorder,
} from "@/lib/voiceDictation";

type VoiceLang = "hi-IN" | "en-IN" | "auto";

/**
 * Set once the browser's own recognition has said it will not work on this
 * device (iPhone with Siri off, some webviews) so later taps go straight to
 * recording instead of failing first every time.
 */
let browserRecognitionRefused = false;

/**
 * Mic button that appends dictated text to a field.
 *
 * Two paths, in order of preference:
 *  1. The browser's own recognition (Chrome, iPhone Safari) — instant, free,
 *     no upload.
 *  2. Recording the microphone and sending it to /api/voice/transcribe
 *     (Google STT, staff only) — used where the browser has no recognition
 *     or refuses it, e.g. in-app webviews. iPhone Safari records audio/mp4,
 *     which Google cannot read, so it is converted to WAV first.
 *
 * Dictation always *appends*: a teacher adding a second sentence must
 * never silently wipe what they already typed.
 *
 * Two ways to wire it (2026-09-30):
 *  - `value` + `onChange` — the button appends to the latest value itself;
 *  - `onText` — the caller gets the dictated piece and appends it (the
 *    original API; lesson plans and meeting minutes use it).
 */
export function VoiceDictateButton({
  onText,
  value,
  onChange,
  lang = "auto",
  title = "Dictate",
  disabled = false,
  className = "",
}: {
  onText?: (text: string) => void;
  value?: string;
  onChange?: (next: string) => void;
  lang?: VoiceLang;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "listening" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);

  // Latest props, read when the (async) result lands — the closure from the
  // render that started dictation would append to a stale value and drop
  // whatever was typed meanwhile.
  const latest = useRef({ onText, value, onChange, lang });
  latest.current = { onText, value, onChange, lang };

  const mountedRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heardRef = useRef("");
  const ownsRecognitionRef = useRef(false);

  function deliver(text: string) {
    const t = text.trim();
    if (!t || !mountedRef.current) return;
    const cur = latest.current;
    if (cur.onChange) cur.onChange(appendDictation(cur.value ?? "", t));
    else cur.onText?.(t);
    setAdded(true);
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = setTimeout(() => setAdded(false), 2500);
  }

  function clearTimers() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    stopTimerRef.current = null;
    tickRef.current = null;
  }

  function releaseMic() {
    // Release the mic as soon as we stop; leaving it open keeps the phone's
    // recording indicator on and drains battery.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    setSupported(
      browserSpeechRecognitionSupported() ||
        (typeof navigator !== "undefined" &&
          !!navigator.mediaDevices?.getUserMedia &&
          typeof MediaRecorder !== "undefined"),
    );
    return () => {
      // Unmounted mid-dictation (dialog closed, tab switched): stop, free
      // the mic, and do NOT upload — nobody is there to receive the text.
      mountedRef.current = false;
      // Recognition is one global session; only stop it if it is ours, or
      // a row unmounting in a list would kill another field's dictation.
      if (ownsRecognitionRef.current) stopVoiceListen();
      clearTimers();
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        /* already stopped */
      }
      releaseMic();
    };
  }, []);

  async function startRecording() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice typing is not available in this browser");
      setState("idle");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone blocked — allow it in the browser settings");
      setState("idle");
      return;
    }
    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    let recorder: MediaRecorder;
    try {
      const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      releaseMic();
      setError("Could not start recording on this phone");
      setState("idle");
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      clearTimers();
      releaseMic();
      setRecording(false);
      if (!mountedRef.current) return;
      const type = recorder.mimeType || chunksRef.current[0]?.type || "";
      let blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (blob.size === 0) {
        setError("Nothing was recorded — try again");
        setState("idle");
        return;
      }
      setState("working");
      try {
        if (needsWavConversion(blob.type)) blob = await recordingToWav(blob);
      } catch {
        if (!mountedRef.current) return;
        setError("Could not read the recording on this phone");
        setState("idle");
        return;
      }
      const l = latest.current.lang;
      const result = await transcribeAudioBlob(blob, l === "auto" ? "hi-IN" : l);
      if (!mountedRef.current) return;
      setState("idle");
      if (result.ok && result.text) deliver(result.text);
      else setError(result.error || "Could not hear you — try again");
    };
    // Timeslice so Safari hands over data during the recording, not only at stop.
    recorder.start(1000);
    setRecording(true);
    setElapsedMs(0);
    const started = Date.now();
    tickRef.current = setInterval(() => setElapsedMs(Date.now() - started), 500);
    // Google's synchronous recognizer stops at one minute; stop before it.
    stopTimerRef.current = setTimeout(() => {
      try {
        if (recorder.state === "recording") recorder.stop();
      } catch {
        /* already stopped */
      }
    }, MAX_DICTATION_MS);
    setState("listening");
  }

  function startBrowserRecognition() {
    heardRef.current = "";
    let switchedToRecorder = false;
    const ok = startVoiceListen({
      lang,
      // Cumulative final text for this session; delivered once, on end, so
      // a browser that repeats results cannot append the same words twice.
      onFinal: (text) => {
        heardRef.current = text;
      },
      onError: (msg, code) => {
        if (speechErrorMeansUseRecorder(code)) {
          browserRecognitionRefused = true;
          switchedToRecorder = true;
          void startRecording();
          return;
        }
        if (mountedRef.current) setError(msg);
      },
      onEnd: () => {
        ownsRecognitionRef.current = false;
        if (switchedToRecorder || !mountedRef.current) return;
        deliver(heardRef.current);
        heardRef.current = "";
        setState("idle");
      },
    });
    if (ok) {
      ownsRecognitionRef.current = true;
      setState("listening");
    }
  }

  function start() {
    if (disabled) return;
    setError(null);
    setAdded(false);
    if (browserSpeechRecognitionSupported() && !browserRecognitionRefused) {
      startBrowserRecognition();
      return;
    }
    void startRecording();
  }

  function stop() {
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") {
      try {
        rec.stop(); // onstop uploads what was said so far
      } catch {
        releaseMic();
        setState("idle");
      }
      return;
    }
    // Browser recognition: onEnd delivers what was heard and resets state.
    stopVoiceListen();
  }

  // Hidden entirely where neither path exists, rather than showing a
  // button that cannot work.
  if (supported === false) return null;

  const listening = state === "listening";
  const label = listening ? "Stop dictation" : title;

  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 align-middle ${className}`}>
      <button
        type="button"
        onClick={listening ? stop : start}
        disabled={disabled || state === "working"}
        title={label}
        aria-label={label}
        aria-pressed={listening}
        // Thumb-sized on phones (teachers dictate from the phone), compact on desktop.
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition sm:h-7 sm:w-7 disabled:opacity-40 ${
          listening
            ? "animate-pulse border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
            : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--brand-deep)]"
        }`}
      >
        {state === "working" ? (
          <Loader2 className="h-4 w-4 animate-spin sm:h-3.5 sm:w-3.5" />
        ) : listening ? (
          <Square className="h-3.5 w-3.5 fill-current sm:h-3 sm:w-3" />
        ) : (
          <Mic className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        )}
      </button>
      <span aria-live="polite" className="min-w-0 text-[11px] leading-tight sm:text-[10px]">
        {error ? (
          <span className="text-[var(--danger)]">{error}</span>
        ) : listening ? (
          <span className="font-semibold text-[var(--danger)]">
            {recording
              ? `● ${formatDictationClock(elapsedMs)} / ${formatDictationClock(MAX_DICTATION_MS)} — tap ■ to finish`
              : "● Listening… speak now"}
          </span>
        ) : state === "working" ? (
          <span className="text-[var(--muted)]">Writing it down…</span>
        ) : added ? (
          <span className="inline-flex items-center gap-0.5 text-[var(--success)]">
            <Check className="h-3 w-3" /> Added
          </span>
        ) : null}
      </span>
    </span>
  );
}
