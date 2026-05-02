"use client";

/**
 * /auth/forgot-password — request a password-reset email.
 *
 * The API responds 200 OK whether or not the email is registered (anti-
 * enumeration). We surface a single neutral confirmation regardless of
 * the actual outcome — never "no such account" or "email sent".
 *
 * In non-prod, the API includes a `devResetUrl` in the response so
 * developers can click through without checking a real mailbox. We render
 * it inline below the confirmation when it's present. Production strips
 * the field server-side so the link can never appear.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { FlaskConical, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { apiForgotPassword, ApiProblem } from "@/lib/api/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const res = await apiForgotPassword({ email: email.trim() });
        setSubmitted(true);
        setDevResetUrl(res.devResetUrl ?? null);
      } catch (err) {
        // The endpoint should never fail with a Problem unless the email
        // failed Zod validation. Other errors → generic network message.
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
            <h1 className="text-xl font-bold tracking-tight">
              Forgot your password?
            </h1>
            <p className="text-sm text-muted-foreground">
              We&apos;ll email you a link to set a new one.
            </p>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardContent className="pt-6 space-y-4">
            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isPending}
                  />
                </div>

                {error && (
                  <p className="text-xs text-destructive leading-snug">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Send reset link"
                  )}
                </Button>
              </form>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <Mail className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">Check your inbox.</p>
                    <p className="text-muted-foreground leading-snug">
                      If an account exists for <strong>{email}</strong>, we
                      just sent it a link to reset the password. The link
                      expires in 1 hour.
                    </p>
                  </div>
                </div>

                {devResetUrl && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1.5">
                    <p className="font-semibold">Dev shortcut</p>
                    <p>
                      Production strips this field. In dev you can click
                      through without an inbox:
                    </p>
                    <Link
                      href={devResetUrl}
                      className="block break-all underline hover:no-underline"
                    >
                      {devResetUrl}
                    </Link>
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 text-center">
              <Link
                href="/auth/login"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back to sign-in
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Instigenie ERP · /auth/forgot-password
        </p>
      </div>
    </div>
  );
}
