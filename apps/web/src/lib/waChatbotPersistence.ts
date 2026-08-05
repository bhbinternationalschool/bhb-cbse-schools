import {
  loadWaChatbotFlows,
  writeWaChatbotFlowsLocalRaw,
  type WaChatbotFlowsState,
} from "@/lib/waChatbotFlows";

export async function ensureWaChatbotFlowsHydrated(): Promise<void> {
  // Built-in flows ship in code; custom flows are localStorage-only for now.
  loadWaChatbotFlows();
}

export function scheduleWaChatbotFlowsSync(state: WaChatbotFlowsState) {
  writeWaChatbotFlowsLocalRaw(state);
}
