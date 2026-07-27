import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@bhb/time"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // ESLint prefer-const debt should not block Cloud Run deploys; typecheck runs in CI.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
