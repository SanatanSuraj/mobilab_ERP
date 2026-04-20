"use client";

/**
 * /auth/login — real-API login.
 *
 * This page talks to apps/api instead of the mock store. It coexists with
 * the existing /login mock page during the migration. Once all pages have
 * moved to the real API, /login can be deleted and this one mounted as
 * the default.
 *
 * Keep it plain React — no Next.js Server Actions / experimental features —
 * so it stays compatible with whatever version gyrations the framework is
 * going through.
 *
 * Next.js 16 requires client components that call `useSearchParams()` to
 * live inside a <Suspense> boundary during production prerender. We split
 * the form into an inner `<LoginForm>` and wrap it with Suspense at the
 * page level — see docs/app/api-reference/functions/use-search-params.
 */

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { apiLogin, ApiProblem } from "@/lib/api/auth";

// Token storage: we use sessionStorage for dev simplicity. Production should
// move to httpOnly cookies set by a Next.js Route Handler that proxies to
// the API so the access token never touches JS.
const ACCESS_KEY = "mobilab-access";
const REFRESH_KEY = "mobilab-refresh";

export default function RealLoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
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

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("from") ?? "/";
  const surface = params.get("surface") === "portal" ? "portal" : "internal";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const res = await apiLogin({ email, password, surface });
        sessionStorage.setItem(ACCESS_KEY, res.accessToken);
        sessionStorage.setItem(REFRESH_KEY, res.refreshToken);
        router.push(redirectTo);
      } catch (err) {
        if (err instanceof ApiProblem) {
          setError(err.problem.detail ?? err.problem.title);
        } else {
          setError("Could not reach the API. Is it running on :4000?");
        }
      }
    });
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <FlaskConical className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Mobilab ERP</h1>
            <p className="text-sm text-muted-foreground">
              {surface === "portal"
                ? "Customer portal sign-in"
                : "Sign in (real API)"}
            </p>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardContent className="pt-6 space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@mobilab.local"
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
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-xs text-destructive leading-snug">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            <p className="text-[11px] text-muted-foreground leading-snug pt-1">
              Dev seeds (password <code>mobilab_dev_2026</code>):{" "}
              <code>admin@mobilab.local</code>,{" "}
              <code>finance@mobilab.local</code>,{" "}
              <code>prodmgr@mobilab.local</code>, etc.
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Mobilab ERP · Phase 1 · /auth/login (real API)
        </p>
      </div>
    </div>
  );
}
