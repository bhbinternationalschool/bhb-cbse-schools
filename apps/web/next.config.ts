import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@bhb/time"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
