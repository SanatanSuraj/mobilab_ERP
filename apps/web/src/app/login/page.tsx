"use client";

/**
 * Login page — /login (legacy mock)
 *
 * This page existed when auth was entirely mock. The real login surface is
 * now at /auth/login (see apps/web/src/app/auth/login/page.tsx). To avoid
 * users typing real credentials (admin@instigenie.local / instigenie_dev_2026)
 * into the old mock form — which only validates against @instigenie.in emails
 * with password "demo1234" and would show a misleading error — this page
 * now:
 *
 *   1. Redirects to /auth/login by default, preserving ?from=… so
 *      post-login routing still works.
 *   2. Keeps the dev-panel persona switcher behind an explicit ?dev=1 flag
 *      for still-un-migrated prototype pages (admin/users, sidebar chip,
 *      etc.) that read their state from the Zustand mock store.
 *
 * Delete this file once every prototype page reads from the real /auth/me
 * identity and the dev-panel shortcut is no longer useful.
 */

import { Suspense, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  useAuthStore,
  MOCK_USERS_BY_ROLE,
  type UserRole,
} from "@/store/auth.store";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Cookie set client-side — proxy reads this for optimistic auth check. */
const SESSION_COOKIE = "instigenie-session";

const ALL_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "MANAGEMENT",
  "SALES_REP",
  "SALES_MANAGER",
  "FINANCE",
  "PRODUCTION",
  "PRODUCTION_MANAGER",
  "RD",
  "QC_INSPECTOR",
  "QC_MANAGER",
  "STORES",
  "CUSTOMER",
];

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN:        "Super Admin",
  MANAGEMENT:         "Management / HOD",
  SALES_REP:          "Sales Rep",
  SALES_MANAGER:      "Sales Manager",
  FINANCE:            "Finance",
  PRODUCTION:         "Production Technician",
  PRODUCTION_MANAGER: "Production Manager",
  RD:                 "R&D Lead",
  QC_INSPECTOR:       "QC Inspector",
  QC_MANAGER:         "QC Manager",
  STORES:             "Stores Manager",
  CUSTOMER:           "Customer Portal",
};

// ─── Cookie Helper ────────────────────────────────────────────────────────────

function setSessionCookie(value: string) {
  // SameSite=Lax: safe for same-origin navigation, blocks CSRF from cross-site.
  // Not httpOnly — this is a prototype. Use a Server Action + httpOnly cookie
  // for production to prevent XSS token theft.
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

// ─── Component ────────────────────────────────────────────────────────────────

// Next.js 16 requires useSearchParams() consumers to live inside a
// <Suspense> boundary so static prerender can split dynamic from static.
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginRouter />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Decides which flavour of the /login page to render:
 *   - Default: bounce to /auth/login (real API), preserving ?from=…
 *   - ?dev=1: render the dev-panel quick-login for unmigrated prototype
 *     pages that still read from the mock Zustand store.
 */
function LoginRouter() {
  const router = useRouter();
  const params = useSearchParams();
  const isDevPanel = params.get("dev") === "1";
  const from = params.get("from");

  useEffect(() => {
    if (isDevPanel) return;
    const target = new URL("/auth/login", window.location.origin);
    if (from) target.searchParams.set("from", from);
    router.replace(target.pathname + target.search);
  }, [isDevPanel, from, router]);

  if (isDevPanel) {
    return <DevPanelOnly />;
  }

  // Brief "redirecting…" state while the useEffect above fires on mount.
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Redirecting to sign-in…
      </div>
    </div>
  );
}

/**
 * Dev-panel-only login. Reachable via /login?dev=1. Bypasses the real API
 * and writes directly to the mock Zustand store — for prototype pages that
 * have not yet been migrated to the real /auth/me identity.
 */
function DevPanelOnly() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("from") ?? "/";

  const setRole = useAuthStore((s) => s.setRole);
  const fetchPermissions = useAuthStore((s) => s.fetchPermissions);

  const [selectedRole, setSelectedRole] = useState<UserRole>("PRODUCTION_MANAGER");
  const [showDevPanel, setShowDevPanel] = useState(true);
  const [isPending, startTransition] = useTransition();

  function completeLogin(role: UserRole) {
    setRole(role);
    setSessionCookie(role);
    fetchPermissions();
  }

  function handleDevLogin() {
    startTransition(() => {
      completeLogin(selectedRole);
      router.push(redirectTo);
    });
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <FlaskConical className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Instigenie ERP</h1>
            <p className="text-sm text-muted-foreground">
              Dev quick-login (mock store only)
            </p>
          </div>
        </div>

        {/* Card */}
        <Card className="shadow-sm">
          <CardContent className="pt-6 space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] leading-snug text-amber-900">
              <p className="font-medium">Dev-panel mode</p>
              <p className="mt-1">
                This populates the mock auth store without hitting the
                backend. For real credentials use{" "}
                <a
                  href="/auth/login"
                  className="underline font-medium"
                >
                  /auth/login
                </a>
                .
              </p>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowDevPanel((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-full"
              >
                <span className="text-amber-500">🛠</span>
                <span className="font-medium">Dev: quick login</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 ml-auto transition-transform ${
                    showDevPanel ? "rotate-180" : ""
                  }`}
                />
              </button>

              {showDevPanel && (
                <div className="mt-3 space-y-2">
                  <select
                    value={selectedRole}
                    onChange={(e) =>
                      setSelectedRole(e.target.value as UserRole)
                    }
                    className="w-full text-xs rounded border border-border bg-background px-2.5 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]} ({MOCK_USERS_BY_ROLE[r].name})
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={handleDevLogin}
                    disabled={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      `Login as ${ROLE_LABELS[selectedRole]}`
                    )}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Instigenie ERP · /login?dev=1 (mock)
        </p>
      </div>
    </div>
  );
}
