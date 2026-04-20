/**
 * Minimal client-side auth guard for pages that have been migrated to the
 * real /crm/* API. If no access token is present in sessionStorage, we
 * bounce the user to /auth/login and preserve the target path via
 * `?from=...`.
 *
 * Why per-page instead of in the dashboard layout?
 *   - The (dashboard) layout still hosts a lot of prototype pages that
 *     read from the mock auth store. Pushing this guard up there would
 *     break them all at once.
 *   - Migrated pages opt into the guard by calling this hook; unmigrated
 *     pages stay on the mock path. Once every page is migrated the guard
 *     can be lifted into the layout and this hook retired.
 *
 * The hook returns a 3-state status rather than a boolean so the caller
 * can render a stable skeleton during the brief window where we have
 * yet to read sessionStorage. Avoids the "flash of unauthenticated
 * content" that plain booleans produce on first render.
 */

"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getTenantAccessToken } from "@/lib/api/tenant-fetch";

export type GuardStatus = "checking" | "authenticated" | "redirecting";

export function useTenantAuthGuard(): GuardStatus {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<GuardStatus>("checking");

  useEffect(() => {
    const token = getTenantAccessToken();
    if (token) {
      setStatus("authenticated");
      return;
    }
    setStatus("redirecting");
    const from = encodeURIComponent(pathname ?? "/");
    router.replace(`/auth/login?from=${from}`);
  }, [pathname, router]);

  return status;
}
