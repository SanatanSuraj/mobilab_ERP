"use client";

/**
 * Production → Products
 *
 * Same ProductCatalogPage as /admin/products. Production Managers /
 * R&D / QC land here from the Plan-to-Produce section; their visible
 * actions are narrowed by `can()` inside the page (read-only for
 * operators/QC, create+update for PM/R&D, delete gated to admins).
 */

import { ProductCatalogPage } from "@/components/products/ProductCatalogPage";

export default function ProductionProductsPage() {
  return <ProductCatalogPage />;
}
