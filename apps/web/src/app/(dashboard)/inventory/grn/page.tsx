import { redirect } from "next/navigation";

/**
 * Legacy `/inventory/grn` route — GRNs now live in the procurement
 * domain at `/procurement/inward` (vendor receipt) and
 * `/procurement/grns/:id` (single GRN detail). This route is kept as a
 * 307 redirect so old links/bookmarks still resolve.
 */
export default function GrnRedirectPage() {
  redirect("/procurement/inward");
}
