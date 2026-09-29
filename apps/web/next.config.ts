import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The withhold policy briefly lived at its own address, linked from nowhere.
  // It is now a tab on the Defaulters page. Redirected here, at the routing
  // layer, rather than with redirect() inside a page: the in-page version left
  // a blank screen and a React removeChild error when reached by client-side
  // navigation, because the page tore down mid-transition.
  async redirects() {
    return [
      {
        source: "/fees/defaulter-policy",
        destination: "/fees/defaulters?tab=policy",
        permanent: false,
      },
      // Old module URLs. A page-level redirect() inside the (erp) layout
      // streams the shell first and then swaps it on the client, which
      // crashed React ("reading 'removeChild'") and left a blank screen
      // (seen on /student-leave, 2026-09-30). An HTTP redirect never renders.
      { source: "/student-leave", destination: "/attendance?tab=leave", permanent: false },
      { source: "/notices", destination: "/comms?tab=notices", permanent: false },
      { source: "/store", destination: "/inventory", permanent: false },
      { source: "/purchase", destination: "/inventory?tab=purchase", permanent: false },
      { source: "/rte", destination: "/admissions?tab=rte", permanent: false },
    ];
  },
  transpilePackages: ["@bhb/time"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Lint is a dedicated CI job (.github/workflows/ci.yml) rather than a
  // build step, so Cloud Run deploys stay fast. The prefer-const debt this
  // originally worked around is cleared — lint is at 0 errors, and CI fails
  // the PR on any new one, so nothing is being silently skipped here.
  eslint: { ignoreDuringBuilds: true },
  images: {
    // Photographs and the crest are served from Supabase Storage. Without this
    // next/image refuses the host outright, which is why every uploaded image
    // in the app was a plain <img> on a base64 string.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // Declaring remotePatterns makes Next ask for the local ones too. The
    // crest and logo are cache-busted with `?v=`, so the pattern has to allow
    // a query string or every one of them warns now and fails in Next 16.
    localPatterns: [{ pathname: "/**", search: "" }, { pathname: "/**" }],
  },
};

export default nextConfig;
