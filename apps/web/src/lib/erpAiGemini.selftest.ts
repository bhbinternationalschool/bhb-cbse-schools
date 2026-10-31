import assert from "assert";
import { geminiModel } from "@/lib/erpAiGemini.server";

export async function runSelftest() {
  // Test 1: default (flash tier)
  const flashModel = geminiModel();
  assert(
    flashModel.includes("flash"),
    `Default model should be flash-tier, got: ${flashModel}`,
  );
  assert(
    !flashModel.includes("2.5") && !flashModel.includes("2.0"),
    `Flash model should not be 2.x: ${flashModel}`,
  );

  // Test 2: pro tier
  const proModel = geminiModel("pro");
  assert(
    proModel.includes("3.1"),
    `Pro model should be 3.1 after 2.5-pro retirement, got: ${proModel}`,
  );
  assert(
    !proModel.includes("gemini-2.5-pro"),
    `Pro model must not be the deprecated gemini-2.5-pro, got: ${proModel}`,
  );

  // Test 3: explicit pro tier
  const explicitPro = geminiModel("pro");
  assert(
    explicitPro === proModel,
    `Explicit pro tier should match pro() result`,
  );

  console.log(`✓ erpAiGemini: model defaults are correct (flash: ${flashModel}, pro: ${proModel})`);
}

if (require.main === module) {
  runSelftest().catch(console.error);
}
