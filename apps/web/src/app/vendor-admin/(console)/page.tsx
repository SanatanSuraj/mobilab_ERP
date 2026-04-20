import { redirect } from "next/navigation";

/**
 * Default landing for /vendor-admin — hop straight to the tenants list.
 * We don't render a separate "console dashboard" today; if we add one later
 * (health metrics, outstanding action items), this is where it lands.
 */
export default function VendorAdminIndex() {
  redirect("/vendor-admin/tenants");
}
