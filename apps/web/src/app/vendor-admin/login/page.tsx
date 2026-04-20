"use client";

/**
 * /vendor-admin/login — Mobilab staff sign-in for the vendor-admin console.
 *
 * This is the Sprint 3 vendor surface. It does NOT use the tenant auth flow:
 *   - No surface picker (vendor admins don't belong to orgs)
 *   - No tenant picker (a vendor admin isn't an "org member")
 *   - Different token storage keys
 *
 * Visually styled differently from /auth/login so internal staff can tell at
 * a glance that they're on the admin surface, not a tenant login page.
 */

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

import { ApiProblem } from "@/lib/api/vendor-admin";
import { useVendorAuthStore } from "@/store/vendor-auth.store";

export default function VendorAdminLoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("from") ?? "/vendor-admin/tenants";

  const login = useVendorAuthStore((s) => s.login);

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
        await login(email, password);
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
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <ShieldCheck className="h-6 w-6 text-slate-950" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Mobilab Vendor Console
            </h1>
            <p className="text-sm text-slate-400">
              Staff-only sign-in · tenant lifecycle & audit
            </p>
          </div>
        </div>

        <Card className="shadow-sm bg-slate-900 border-slate-800">
          <CardContent className="pt-6 space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="v-email" className="text-slate-200">
                  Email
                </Label>
                <Input
                  id="v-email"
                  type="email"
                  placeholder="staff@mobilab.in"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isPending}
                  className="bg-slate-950 border-slate-800 text-slate-50 placeholder:text-slate-600"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="v-password" className="text-slate-200">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="v-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isPending}
                    className="bg-slate-950 border-slate-800 text-slate-50 placeholder:text-slate-600 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
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
                <p className="text-xs text-rose-400 leading-snug">{error}</p>
              )}

              <Button
                type="submit"
                disabled={isPending}
                className="w-full bg-amber-500 text-slate-950 hover:bg-amber-400"
              >
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

            <p className="text-[11px] text-slate-500 leading-snug pt-1">
              Dev seeds (password <code>mobilab_dev_2026</code>):{" "}
              <code>ops@mobilab.in</code>, <code>support@mobilab.in</code>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-600">
          Mobilab Vendor Console · Sprint 3 · /vendor-admin/auth/login
        </p>
      </div>
    </div>
  );
}
