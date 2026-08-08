import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@bhb/time"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Lint is a dedicated CI job (.github/workflows/ci.yml) rather than a
  // build step, so Cloud Run deploys stay fast. The prefer-const debt this
  // originally worked around is cleared — lint is at 0 errors, and CI fails
  // the PR on any new one, so nothing is being silently skipped here.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
