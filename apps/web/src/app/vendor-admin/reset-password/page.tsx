"use client";

/**
 * /vendor-admin/reset-password?token=... — set a new password for a vendor
 * admin using a token from the reset email.
 *
 * Mirror of /auth/reset-password but styled for the dark vendor surface
 * and pointed at the /vendor-admin/auth/* API endpoints. On success,
 * lands the user back at /vendor-admin/login (they're now signed out
 * everywhere).
 */

import { Suspense, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  apiVendorPreviewResetPassword,
  apiVendorResetPassword,
  ApiProblem,
} from "@/lib/api/vendor-admin";

const MIN_PASSWORD = 10;

export default function VendorResetPasswordPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ResetForm />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  );
}

type Phase =
  | { kind: "validating" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; email: string; expiresAt: string }
  | { kind: "done" };

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [phase, setPhase] = useState<Phase>({ kind: "validating" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        if (!cancelled) {
          setPhase({
            kind: "invalid",
            message: "This link is missing its reset token.",
          });
        }
        return;
      }
      try {
        const res = await apiVendorPreviewResetPassword(token);
        if (!cancelled) {
          setPhase({
            kind: "ready",
            email: res.email,
            expiresAt: res.expiresAt,
          });
        }
      } catch {
        if (!cancelled) {
          setPhase({
            kind: "invalid",
            message: "This link is invalid or has expired.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmitError("");
    if (password.length < MIN_PASSWORD) {
      setSubmitError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setSubmitError("The two passwords don't match.");
      return;
    }
    startTransition(async () => {
      try {
        await apiVendorResetPassword({ token, newPassword: password });
        setPhase({ kind: "done" });
      } catch (err) {
        if (err instanceof ApiProblem) {
          if (err.problem.status === 404) {
            setPhase({
              kind: "invalid",
              message: "This link is invalid or has expired.",
            });
          } else {
            setSubmitError(err.problem.detail ?? err.problem.title);
          }
        } else {
          setSubmitError("Could not reach the API. Is it running on :4000?");
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
              Choose a new password
            </h1>
            {phase.kind === "ready" && (
              <p className="text-sm text-slate-400">
                Vendor Console · resetting{" "}
                <span className="text-slate-200">{phase.email}</span>
              </p>
            )}
          </div>
        </div>

        <Card className="shadow-sm bg-slate-900 border-slate-800">
          <CardContent className="pt-6 space-y-4">
            {phase.kind === "validating" && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              </div>
            )}

            {phase.kind === "invalid" && (
              <div className="space-y-3">
                <p className="text-sm text-rose-400">{phase.message}</p>
                <p className="text-xs text-slate-400 leading-snug">
                  Reset links expire 1 hour after they&apos;re sent and can
                  only be used once.
                </p>
                <Link
                  href="/vendor-admin/forgot-password"
                  className="inline-flex items-center text-xs font-medium text-amber-400 hover:underline"
                >
                  Request a new reset link →
                </Link>
              </div>
            )}

            {phase.kind === "ready" && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="v-password" className="text-slate-200">
                    New password
                  </Label>
                  <div className="relative">
                    <Input
                      id="v-password"
                      type={showPassword ? "text" : "password"}
                      placeholder={`At least ${MIN_PASSWORD} characters`}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={MIN_PASSWORD}
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

                <div className="space-y-1.5">
                  <Label htmlFor="v-confirm" className="text-slate-200">
                    Confirm new password
                  </Label>
                  <Input
                    id="v-confirm"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={MIN_PASSWORD}
                    disabled={isPending}
                    className="bg-slate-950 border-slate-800 text-slate-50 placeholder:text-slate-600"
                  />
                </div>

                {submitError && (
                  <p className="text-xs text-rose-400 leading-snug">
                    {submitError}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={isPending}
                  className="w-full bg-amber-500 text-slate-950 hover:bg-amber-400"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating password…
                    </>
                  ) : (
                    "Set new password"
                  )}
                </Button>

                <p className="text-[11px] text-slate-500 leading-snug">
                  You&apos;ll be signed out of every device after this.
                </p>
              </form>
            )}

            {phase.kind === "done" && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Password updated.</p>
                    <p className="text-xs text-slate-400 leading-snug">
                      Every vendor session has been signed out. Sign in
                      again with the new password.
                    </p>
                  </div>
                </div>
                <Link href="/vendor-admin/login" className="block">
                  <Button className="w-full bg-amber-500 text-slate-950 hover:bg-amber-400">
                    Go to vendor sign-in
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-600">
          Instigenie Vendor Console · /vendor-admin/reset-password
        </p>
      </div>
    </div>
  );
}
