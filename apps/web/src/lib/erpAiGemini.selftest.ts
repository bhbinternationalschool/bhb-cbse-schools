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

  // Test 4: env var with deprecated model (gemini-2.5-pro) is mapped to 3.1-pro
  const originalProModel = process.env.GEMINI_PRO_MODEL;
  const originalFlashModel = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_PRO_MODEL = "gemini-2.5-pro";
    const mappedPro = geminiModel("pro");
    assert(
      mappedPro === "gemini-3.1-pro",
      `Deprecated gemini-2.5-pro should map to gemini-3.1-pro, got: ${mappedPro}`,
    );

    // Test 5: deprecated flash model mapping
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    const mappedFlash = geminiModel();
    assert(
      mappedFlash === "gemini-3.6-flash",
      `Deprecated gemini-2.5-flash should map to gemini-3.6-flash, got: ${mappedFlash}`,
    );
  } finally {
    // Restore original env vars
    if (originalProModel !== undefined) process.env.GEMINI_PRO_MODEL = originalProModel;
    else delete process.env.GEMINI_PRO_MODEL;
    if (originalFlashModel !== undefined) process.env.GEMINI_MODEL = originalFlashModel;
    else delete process.env.GEMINI_MODEL;
  }

  console.log(`✓ erpAiGemini: model defaults are correct (flash: ${flashModel}, pro: ${proModel}) and deprecated models are mapped`);
}

if (require.main === module) {
  runSelftest().catch(console.error);
}
