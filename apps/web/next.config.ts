import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

// Wrap with @next/bundle-analyzer when ANALYZE=true is set in the env. Off
// by default — adds ~1MB of HTML report files to .next, only useful when
// hunting bundle bloat. Run with: ANALYZE=true pnpm --filter @instigenie/web build
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

const nextConfig: NextConfig = {
  // Standalone output bundles only the deps Next traced as needed at runtime,
  // so the production Docker image (ops/docker/web.Dockerfile) can ship just
  // .next/standalone + .next/static + public — no node_modules layer.
  output: "standalone",

  // @instigenie/contracts is consumed as a precompiled workspace package:
  // its package.json "exports" map points at ./dist/*.js (with ./dist/*.d.ts
  // for types), so we do NOT need `transpilePackages` here. Turbopack is
  // strict about ESM ".js" specifiers inside source-only packages (rejects
  // `import "./billing.js"` that points at `billing.ts`), so always consume
  // the compiled output. `pnpm turbo build` runs the contracts `build`
  // script first via the `^build` dependency in turbo.json.

  // Per ARCHITECTURE.md Appendix D — retire deprecated namespaces.
  // These redirects keep existing bookmarks working while we consolidate.
  async redirects() {
    return [
      // Production namespace consolidation (mfg/ and manufacturing/ → production/)
      { source: "/mfg/:path*", destination: "/production/:path*", permanent: true },
      { source: "/manufacturing/:path*", destination: "/production/:path*", permanent: true },
      // Finance namespace consolidation (accounting/ → finance/)
      { source: "/accounting/invoices", destination: "/finance/sales-invoices", permanent: true },
      { source: "/accounting/invoices/:id", destination: "/finance/sales-invoices/:id", permanent: true },
      { source: "/accounting/ledger", destination: "/finance/customer-ledger", permanent: true },
      { source: "/accounting/payments", destination: "/finance/reports?type=payments", permanent: true },
      { source: "/accounting/:path*", destination: "/finance", permanent: true },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
