"use client";

/**
 * /auth/reset-password?token=... — set a new password using a token from
 * the reset email.
 *
 * Three states this component cycles through:
 *   1. validating  — calls /auth/reset-password/preview to confirm the
 *                    token is alive and pull the email it belongs to.
 *   2. ready       — preview succeeded; render the new-password form.
 *   3. done        — POST /auth/reset-password succeeded; offer a link
 *                    back to sign-in.
 *
 * If the preview fails (token unknown / expired / consumed), surface a
 * single neutral "link is invalid or has expired" message — the API
 * deliberately doesn't distinguish.
 *
 * useSearchParams() requires the page tree to live under <Suspense> in
 * Next.js 16 production prerender; we mirror /auth/login's split.
 */

import { Suspense, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FlaskConical, Loader2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  apiPreviewResetPassword,
  apiResetPassword,
  ApiProblem,
} from "@/lib/api/auth";

const MIN_PASSWORD = 10;

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ResetForm />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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

  // Run the preview once on mount. Treat ANY failure as "invalid token"
  // (the API itself doesn't distinguish unknown / expired / consumed).
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
        const res = await apiPreviewResetPassword(token);
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
        await apiResetPassword({ token, newPassword: password });
        setPhase({ kind: "done" });
      } catch (err) {
        if (err instanceof ApiProblem) {
          // The token might have expired between preview and submit, or
          // someone else consumed it in a parallel tab. Either way, fall
          // back to the invalid state so the user knows to start over.
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
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <FlaskConical className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Choose a new password
            </h1>
            {phase.kind === "ready" && (
              <p className="text-sm text-muted-foreground">
                Resetting password for{" "}
                <span className="font-medium text-foreground">{phase.email}</span>
              </p>
            )}
          </div>
        </div>

        <Card className="shadow-sm">
          <CardContent className="pt-6 space-y-4">
            {phase.kind === "validating" && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {phase.kind === "invalid" && (
              <div className="space-y-3">
                <p className="text-sm text-destructive">{phase.message}</p>
                <p className="text-xs text-muted-foreground leading-snug">
                  Reset links expire 1 hour after they&apos;re sent and can
                  only be used once. Request a new one and try again.
                </p>
                <Link
                  href="/auth/forgot-password"
                  className="inline-flex items-center text-xs font-medium text-primary hover:underline"
                >
                  Request a new reset link →
                </Link>
              </div>
            )}

            {phase.kind === "ready" && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={`At least ${MIN_PASSWORD} characters`}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={MIN_PASSWORD}
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

                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm new password</Label>
                  <Input
                    id="confirm"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={MIN_PASSWORD}
                    disabled={isPending}
                  />
                </div>

                {submitError && (
                  <p className="text-xs text-destructive leading-snug">
                    {submitError}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating password…
                    </>
                  ) : (
                    "Set new password"
                  )}
                </Button>

                <p className="text-[11px] text-muted-foreground leading-snug">
                  You&apos;ll be signed out of every device after this. Use
                  the new password the next time you sign in.
                </p>
              </form>
            )}

            {phase.kind === "done" && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Password updated.
                    </p>
                    <p className="text-xs text-muted-foreground leading-snug">
                      Every active session has been signed out. Sign in
                      again with the new password.
                    </p>
                  </div>
                </div>
                <Link href="/auth/login" className="block">
                  <Button className="w-full">Go to sign-in</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Instigenie ERP · /auth/reset-password
        </p>
      </div>
    </div>
  );
}
