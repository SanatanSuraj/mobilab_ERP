"use client";

/**
 * Client-side guard for the (dashboard) layout.
 *
 * The proxy admits any request that carries the `instigenie-session` cookie,
 * but that cookie is browser-session scoped (persists across tabs) while the
 * JWT lives in sessionStorage (per-tab). Opening a new tab, or landing on a
 * stale cookie, leaves the chrome thinking the user is logged in while every
 * real-API call fails with "missing bearer token".
 *
 * This gate makes the two stores consistent: if sessionStorage has no access
 * token, we clear the cookie and bounce to /auth/login. The mock Zustand
 * store still drives unmigrated pages — we don't touch it — but nothing in
 * the dashboard renders until we've confirmed a real token is present.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getTenantAccessToken } from "@/lib/api/tenant-fetch";

type Status = "checking" | "authenticated" | "redirecting";

export function TenantAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    if (getTenantAccessToken()) {
      setStatus("authenticated");
      return;
    }
    document.cookie = "instigenie-session=; path=/; max-age=0; SameSite=Lax";
    setStatus("redirecting");
    const from = encodeURIComponent(pathname ?? "/");
    router.replace(`/auth/login?from=${from}`);
  }, [pathname, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
