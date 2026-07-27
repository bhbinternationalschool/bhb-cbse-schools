/**
 * Re-export WhatsApp webhook at legacy / documented path.
 * Meta configs often use /api/whatsapp/webhook (see docs/GO_LIVE_INFRA.md).
 */

export { GET, POST, runtime } from "@/app/api/wa/webhook/route";
