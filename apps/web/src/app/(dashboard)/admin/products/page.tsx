"use client";

/**
 * Admin → Products
 *
 * Mirror of /production/products — both routes render the same
 * ProductCatalogPage so UX stays identical regardless of which
 * sidebar entry the user clicked. Permission gating inside the
 * page uses `can()`, so the admin role sees all actions.
 */

import { ProductCatalogPage } from "@/components/products/ProductCatalogPage";

export default function AdminProductsPage() {
  return <ProductCatalogPage />;
}
