import { NextResponse } from "next/server";
import { getIntegrationHealth } from "@/lib/integrationHealth";
import { waOutboundConfigured } from "@/lib/waSend";
import { getWhatsAppSetupReport } from "@/lib/waMeta.server";

export const runtime = "nodejs";

/** Ops status for WhatsApp / PG / storage — safe for desk UI. */
export async function GET() {
  const health = getIntegrationHealth();
  const setup = await getWhatsAppSetupReport();

  return NextResponse.json({
    ...health,
    whatsappOutbound: waOutboundConfigured(),
    whatsappWabaConfigured: !!(setup.wabaId),
    whatsappWabaId: setup.wabaId,
    whatsappDisplayNumber: setup.phoneHealth.displayNumber,
    whatsappBusinessName: setup.phoneHealth.verifiedName,
    whatsappCanSend: setup.phoneHealth.canSendMessage,
    whatsappSubscribedApps: setup.subscribedApps,
    whatsappApprovedTemplates: setup.approvedTemplateCount,
    whatsappSetupUrl: "/api/wa/setup",
    whatsappIssues: setup.issues,
    whatsappFixes: setup.fixes,
    whatsappWebhookUrls: setup.webhookUrls,
  });
}
