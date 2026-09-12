/**
 * The Meta Cloud API webhook payload → what each contact actually sent.
 *
 * Pure, and in its own module for a reason: it used to live inside a server
 * module that imports the AI client, so it could not be unit-tested without
 * pulling half the server in. It went two days fabricating the text of every
 * captionless voice note ("MEDIA audio") — which is not empty, and both gates
 * on the transcription path ask whether the text is empty — so no voice note
 * was ever transcribed and parents who spoke were told the school did not
 * have that information. See waInboundParse.selftest.ts.
 *
 * The rule this module keeps: report the caption, or nothing. What arrived
 * travels in `mediaNote` and `media`; words the parent did not say are never
 * invented on their behalf.
 */

export type WaInboundMediaRef = {
  mediaId: string;
  mediaType: "image" | "document" | "video" | "audio";
  mimeType?: string;
  filename?: string;
};

/** A completed WhatsApp Flow submission (interactive.type "nfm_reply"). */
export type WaInboundFlowResponse = {
  flowToken: string;
  responseJson: string;
};


export function parseMetaWebhookInbound(body: unknown): {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  location?: { lat: number; lng: number; name?: string; address?: string };
  mediaNote?: string;
  media?: WaInboundMediaRef;
  flowResponse?: WaInboundFlowResponse;
}[] {
  const out: {
    fromWaId: string;
    text: string;
    waMessageId?: string;
    profileName?: string;
    location?: { lat: number; lng: number; name?: string; address?: string };
    mediaNote?: string;
    media?: WaInboundMediaRef;
    flowResponse?: WaInboundFlowResponse;
  }[] = [];
  const root = body as {
    entry?: {
      changes?: {
        value?: {
          contacts?: { profile?: { name?: string }; wa_id?: string }[];
          messages?: {
            from?: string;
            id?: string;
            type?: string;
            text?: { body?: string };
            button?: { text?: string; payload?: string };
            image?: { caption?: string; id?: string; mime_type?: string };
            document?: {
              caption?: string;
              filename?: string;
              id?: string;
              mime_type?: string;
            };
            video?: { caption?: string; id?: string; mime_type?: string };
            audio?: { id?: string; mime_type?: string };
            location?: {
              latitude?: number;
              longitude?: number;
              name?: string;
              address?: string;
            };
            interactive?: {
              type?: string;
              button_reply?: { id?: string; title?: string };
              list_reply?: { id?: string; title?: string };
              nfm_reply?: { response_json?: string; body?: string; name?: string };
            };
          }[];
        };
      }[];
    }[];
  };

  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages) continue;
      const name = value.contacts?.[0]?.profile?.name || "";
      for (const msg of value.messages) {
        let text = "";
        let mediaNote: string | undefined;
        let media: WaInboundMediaRef | undefined;
        let location:
          | { lat: number; lng: number; name?: string; address?: string }
          | undefined;
        let flowResponse: WaInboundFlowResponse | undefined;
        if (msg.type === "text") text = msg.text?.body || "";
        else if (msg.type === "button")
          text = msg.button?.payload || msg.button?.text || "";
        else if (msg.type === "interactive") {
          const responseJson = msg.interactive?.nfm_reply?.response_json;
          if (msg.interactive?.type === "nfm_reply" && responseJson) {
            let flowToken = "";
            try {
              const parsed = JSON.parse(responseJson) as { flow_token?: string };
              flowToken = String(parsed.flow_token || "");
            } catch {
              /* leave flowToken empty — caller treats an empty token as unresolvable */
            }
            flowResponse = { flowToken, responseJson };
          } else {
            text =
              msg.interactive?.button_reply?.id ||
              msg.interactive?.button_reply?.title ||
              msg.interactive?.list_reply?.id ||
              msg.interactive?.list_reply?.title ||
              "";
          }
        } else if (msg.type === "image") {
          text = msg.image?.caption || "";
          mediaNote = `image${msg.image?.mime_type ? ` (${msg.image.mime_type})` : ""}`;
          if (msg.image?.id) {
            media = {
              mediaId: msg.image.id,
              mediaType: "image",
              mimeType: msg.image.mime_type,
            };
          }
        } else if (msg.type === "document") {
          text =
            msg.document?.caption ||
            msg.document?.filename ||
            "Document";
          mediaNote = `document:${msg.document?.filename || msg.document?.id || ""}`;
          if (msg.document?.id) {
            media = {
              mediaId: msg.document.id,
              mediaType: "document",
              mimeType: msg.document.mime_type,
              filename: msg.document.filename,
            };
          }
        } else if (msg.type === "video") {
          text = msg.video?.caption || "";
          mediaNote = "video";
          if (msg.video?.id) {
            media = {
              mediaId: msg.video.id,
              mediaType: "video",
              mimeType: msg.video.mime_type,
            };
          }
        } else if (msg.type === "audio") {
          text = "";
          mediaNote = "audio";
          if (msg.audio?.id) {
            media = {
              mediaId: msg.audio.id,
              mediaType: "audio",
              mimeType: msg.audio.mime_type,
            };
          }
        } else if (msg.type === "location" && msg.location) {
          const lat = Number(msg.location.latitude);
          const lng = Number(msg.location.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            location = {
              lat,
              lng,
              name: msg.location.name || undefined,
              address: msg.location.address || undefined,
            };
            text = "";
          } else continue;
        } else continue;
        if (!msg.from) continue;
        if (!text && !mediaNote && !location && !flowResponse) continue;
        out.push({
          fromWaId: msg.from,
          // The CAPTION, or nothing. This used to substitute a label —
          // `MEDIA audio` for a voice note — and that label is what killed
          // voice transcription for the two days it was live: both the
          // webhook's `isVoiceNote` test and the unified bot's transcribe
          // step ask "is the text empty?", and a fabricated label is not
          // empty. So a parent who spoke was answered with "I don't have
          // that information here", and the transcript was never taken.
          // What arrived is reported by `mediaNote` and `media`; inventing
          // words the parent did not say belongs nowhere.
          text,
          waMessageId: msg.id,
          profileName: name,
          location,
          flowResponse,
          mediaNote,
          media,
        });
      }
    }
  }
  return out;
}
