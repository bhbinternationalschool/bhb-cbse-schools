"use client";

import { useEffect, useState } from "react";
import { parseParentVoiceCommand } from "@/lib/parentVoiceIntents";
import {
  speakText,
  startVoiceListen,
  stopVoiceListen,
} from "@/lib/voiceClient";
import type { VoiceLang } from "@/lib/voiceLanguages";
import { VoiceMicButton } from "@/components/voice/VoiceMicButton";

type PortalTab =
  | "fees"
  | "homework"
  | "ptm"
  | "leave"
  | "subjects"
  | "notices"
  | "news"
  | "gallery"
  | "profile";

export function ParentVoiceBar({
  onNavigate,
}: {
  onNavigate: (tab: PortalTab) => void;
}) {
  const [lang, setLang] = useState<VoiceLang>("auto");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => stopVoiceListen(), []);

  async function handleTranscript(text: string) {
    setBusy(true);
    setStatus(null);
    try {
      const local = parseParentVoiceCommand(text);
      if (local.tab) {
        onNavigate(local.tab);
        setStatus(local.reply);
        await speakText(local.reply, { lang: local.speakLang });
        return;
      }

      const res = await fetch("/api/parent-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        tab?: PortalTab;
        reply?: string;
        speakLang?: "en-IN" | "hi-IN";
        error?: string;
      };
      if (json.tab) onNavigate(json.tab);
      const reply = json.reply || local.reply;
      setStatus(reply);
      await speakText(reply, {
        lang: json.speakLang || local.speakLang,
        preferGoogle: true,
      });
    } catch {
      setStatus("Voice error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pb-2">
      <div className="flex items-center gap-2 rounded-xl border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.06)] px-3 py-2">
        <VoiceMicButton
          lang={lang}
          showLangPicker
          onLangChange={setLang}
          disabled={busy}
          onTranscript={(t) => void handleTranscript(t)}
          onError={(m) => setStatus(m)}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-[#0f766e]">
            Voice · बोलिए
          </p>
          <p className="truncate text-[10px] text-[var(--muted)]">
            {busy
              ? "Listening…"
              : status || "Fees, homework, notices — English or Hindi"}
          </p>
        </div>
      </div>
    </div>
  );
}
