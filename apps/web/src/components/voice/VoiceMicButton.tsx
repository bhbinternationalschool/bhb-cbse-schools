"use client";

import { useEffect, useState } from "react";
import {
  browserSpeechRecognitionSupported,
  startVoiceListen,
  stopVoiceListen,
} from "@/lib/voiceClient";
import { VOICE_LANGS, type VoiceLang } from "@/lib/voiceLanguages";

type Props = {
  disabled?: boolean;
  lang?: VoiceLang;
  onLangChange?: (lang: VoiceLang) => void;
  showLangPicker?: boolean;
  onTranscript: (text: string) => void;
  onError?: (msg: string) => void;
  className?: string;
};

export function VoiceMicButton({
  disabled,
  lang = "auto",
  onLangChange,
  showLangPicker = false,
  onTranscript,
  onError,
  className = "",
}: Props) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(browserSpeechRecognitionSupported());
    return () => stopVoiceListen();
  }, []);

  function toggle() {
    if (disabled) return;
    if (listening) {
      stopVoiceListen();
      setListening(false);
      return;
    }
    const ok = startVoiceListen({
      lang,
      onInterim: () => {},
      onFinal: (text) => {
        setListening(false);
        if (text) onTranscript(text);
      },
      onError: (msg) => {
        setListening(false);
        onError?.(msg);
      },
    });
    if (ok) setListening(true);
  }

  if (!supported) return null;

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {showLangPicker && onLangChange ? (
        <select
          className="max-w-[88px] rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-1 py-1 text-[10px]"
          value={lang}
          disabled={disabled || listening}
          onChange={(e) => onLangChange(e.target.value as VoiceLang)}
          aria-label="Voice language"
        >
          {VOICE_LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        title={listening ? "Stop listening" : "Voice command (EN/HI)"}
        aria-label={listening ? "Stop listening" : "Voice input"}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-bold transition ${
          listening
            ? "border-[var(--danger)] bg-[rgba(180,35,24,0.12)] text-[var(--danger)] animate-pulse"
            : "border-[rgba(32,48,80,0.2)] bg-white text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
        } disabled:opacity-40`}
      >
        🎤
      </button>
    </div>
  );
}
