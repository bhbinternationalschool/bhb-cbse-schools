/**
 * Client/server integration health for Week 11–13 ops chips.
 */

import { waOutboundConfigured } from "@/lib/waSend";
import { getPaymentGatewayConfig } from "@/lib/paymentGateway";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export type IntegrationHealth = {
  whatsappOutbound: boolean;
  whatsappWabaConfigured: boolean;
  whatsappDisplayNumber: string | null;
  whatsappBusinessName: string | null;
  whatsappWebhookPath: string;
  whatsappAliasPath: string;
  whatsappNotes: string[];
  paymentGateway: string;
  paymentConfigured: boolean;
  supabase: boolean;
  objectStorage: "supabase" | "gcs" | "local" | "none";
  socialCrossPostEnabled: boolean;
  socialFacebook: boolean;
  socialInstagram: boolean;
  socialTelegram: boolean;
  socialNotes: string[];
};

export function getObjectStorageMode(): IntegrationHealth["objectStorage"] {
  if (isSupabaseConfigured()) return "supabase";
  if (process.env.GCS_BUCKET) return "gcs";
  if (typeof window !== "undefined") return "local";
  return "none";
}

export function getIntegrationHealth(): IntegrationHealth {
  const pg = getPaymentGatewayConfig();
  const outbound = waOutboundConfigured();
  const notes: string[] = [];
  if (outbound) {
    notes.push(
      "Outbound API is configured. Free-text sends only work within 24h of the parent messaging your school number, unless you use an approved Meta template.",
    );
    notes.push(
      "Campaigns & automation need Masters → WhatsApp templates → Sync from Meta (requires WHATSAPP_WABA_ID).",
    );
    notes.push(
      "Fee receipt “Send WhatsApp” uses the API when live; it falls back to wa.me if Meta rejects (e.g. outside 24h window).",
    );
  } else {
    notes.push(
      "Set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID on the server for live sends. Until then, buttons open wa.me on your phone.",
    );
  }

  return {
    whatsappOutbound: outbound,
    whatsappWabaConfigured: false,
    whatsappDisplayNumber: null,
    whatsappBusinessName: null,
    whatsappWebhookPath: "/api/wa/webhook",
    whatsappAliasPath: "/api/whatsapp/webhook",
    whatsappNotes: notes,
    paymentGateway: pg.mode,
    paymentConfigured: pg.configured,
    supabase: isSupabaseConfigured(),
    objectStorage: getObjectStorageMode(),
    socialCrossPostEnabled: false,
    socialFacebook: false,
    socialInstagram: false,
    socialTelegram: false,
    socialNotes: [
      "Configure social accounts in Communications → Social.",
    ],
  };
}
