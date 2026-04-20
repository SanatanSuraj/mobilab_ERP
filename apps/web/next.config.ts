import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo: transpile workspace packages in the Next build.
  transpilePackages: ["@mobilab/contracts"],

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

export default nextConfig;
