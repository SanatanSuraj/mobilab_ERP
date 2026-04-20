"use client";

/**
 * Login page — /login
 *
 * Today  (mock):
 *   • Dev panel lets you switch role instantly and "login as" any persona.
 *   • Prod-style email/password fields accept any @mobilab.in address
 *     with password "demo1234" — matches MOCK_USERS_BY_ROLE emails.
 *   • On submit: sets mobilab-session cookie + Zustand store + redirects.
 *
 * Tomorrow (real auth):
 *   1. POST credentials to a Server Action → receives JWT.
 *   2. Server Action sets httpOnly cookie (not client-side document.cookie).
 *   3. Store only receives user/role/orgId from the JWT claims.
 *   4. Remove MOCK login path entirely.
 */

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, Eye, EyeOff, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  useAuthStore,
  MOCK_USERS_BY_ROLE,
  type UserRole,
} from "@/store/auth.store";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Cookie set client-side — proxy reads this for optimistic auth check. */
const SESSION_COOKIE = "mobilab-session";

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
      <LoginInner />
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

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("from") ?? "/";

  const setRole = useAuthStore((s) => s.setRole);
  const fetchPermissions = useAuthStore((s) => s.fetchPermissions);

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  // Dev panel state
  const [selectedRole, setSelectedRole] = useState<UserRole>("PRODUCTION_MANAGER");
  const [showDevPanel, setShowDevPanel] = useState(
    process.env.NODE_ENV === "development"
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  function completeLogin(role: UserRole) {
    setRole(role);
    setSessionCookie(role); // proxy gate
    fetchPermissions();     // populate _permSet (async, non-blocking)
  }

  function handleDevLogin() {
    startTransition(() => {
      completeLogin(selectedRole);
      router.push(redirectTo);
    });
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    startTransition(async () => {
      // ── MOCK auth ────────────────────────────────────────────────────────
      await new Promise((r) => setTimeout(r, 400)); // simulate network

      const matchedEntry = Object.entries(MOCK_USERS_BY_ROLE).find(
        ([, u]) => u.email.toLowerCase() === email.toLowerCase()
      );

      if (!matchedEntry || password !== "demo1234") {
        setError("Invalid email or password. Hint: use any @mobilab.in email with password demo1234");
        return;
      }
      // ── END MOCK ─────────────────────────────────────────────────────────

      const role = matchedEntry[0] as UserRole;
      completeLogin(role);
      router.push(redirectTo);
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Brand */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <FlaskConical className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Mobilab ERP</h1>
            <p className="text-sm text-muted-foreground">Sign in to your workspace</p>
          </div>
        </div>

        {/* Login Card */}
        <Card className="shadow-sm">
          <CardContent className="pt-6 space-y-4">

            {/* Email/Password form */}
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@mobilab.in"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isPending}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isPending}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword
                      ? <EyeOff className="h-4 w-4" />
                      : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-xs text-destructive leading-snug">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Signing in…</>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            {/* Dev Panel toggle */}
            {process.env.NODE_ENV === "development" && (
              <div className="pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowDevPanel((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-full"
                >
                  <span className="text-amber-500">🛠</span>
                  <span className="font-medium">Dev: quick login</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 ml-auto transition-transform ${showDevPanel ? "rotate-180" : ""}`}
                  />
                </button>

                {showDevPanel && (
                  <div className="mt-3 space-y-2">
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value as UserRole)}
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
                      {isPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : `Login as ${ROLE_LABELS[selectedRole]}`}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Mobilab ERP · ERP-ARCH-MIDSCALE-2025-005
        </p>
      </div>
    </div>
  );
}
