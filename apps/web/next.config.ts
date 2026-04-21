import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @mobilab/contracts is consumed as a precompiled workspace package:
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

export default nextConfig;
