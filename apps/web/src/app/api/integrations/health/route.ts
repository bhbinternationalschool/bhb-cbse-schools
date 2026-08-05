import { NextResponse } from "next/server";
import { requireIntegrationHealthApi } from "@/lib/apiRouteAuth.server";
import { getIntegrationHealth } from "@/lib/integrationHealth";
import { waOutboundConfigured } from "@/lib/waSend";
import { getWhatsAppSetupReport } from "@/lib/waMeta.server";
import { getSocialCrossPostConfig } from "@/lib/socialCrossPost.server";

export const runtime = "nodejs";

/** Ops status for WhatsApp / PG / storage — staff settings access. */
export async function GET(req: Request) {
  const auth = await requireIntegrationHealthApi(req);
  if (!auth.ok) return auth.response;

  const health = getIntegrationHealth();
  const setup = await getWhatsAppSetupReport();
  const social = await getSocialCrossPostConfig();
  const credentials = await import("@/lib/socialIntegrations.server").then((m) =>
    m.getSocialIntegrationsPublic(),
  );

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
    socialCrossPost: social,
    socialCredentials: credentials,
    socialCredentialsApi: "/api/integrations/social/credentials",
    socialCrossPostApi: "/api/integrations/social/cross-post",
  });
}
