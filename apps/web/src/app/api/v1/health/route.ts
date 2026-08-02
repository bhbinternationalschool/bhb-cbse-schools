import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { getIntegrationHealth } from "@/lib/integrationHealth";
import { waOutboundConfigured } from "@/lib/waSend";

export const runtime = "nodejs";

/** GET /api/v1/health — public integration status */
export async function GET() {
  try {
    const health = getIntegrationHealth();
    return apiOk({
      status: "ok",
      version: "v1",
      integrations: health,
      whatsappOutbound: waOutboundConfigured(),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return apiErr(e);
  }
}
