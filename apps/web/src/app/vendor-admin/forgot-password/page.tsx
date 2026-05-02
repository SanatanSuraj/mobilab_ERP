"use client";

/**
 * /vendor-admin/forgot-password — request a reset email for the vendor
 * console. Mirror of /auth/forgot-password styled for the dark vendor
 * surface (slate-950 background, amber accent).
 *
 * Same anti-enumeration semantics: 200 OK regardless of whether the email
 * is registered. devResetUrl is populated only in non-prod responses.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { ShieldCheck, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  apiVendorForgotPassword,
  ApiProblem,
} from "@/lib/api/vendor-admin";

export default function VendorForgotPasswordPage() {
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
        const res = await apiVendorForgotPassword({ email: email.trim() });
        setSubmitted(true);
        setDevResetUrl(res.devResetUrl ?? null);
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
              Forgot your password?
            </h1>
            <p className="text-sm text-slate-400">
              Vendor Console · we&apos;ll email you a reset link.
            </p>
          </div>
        </div>

        <Card className="shadow-sm bg-slate-900 border-slate-800">
          <CardContent className="pt-6 space-y-4">
            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="v-email" className="text-slate-200">
                    Email
                  </Label>
                  <Input
                    id="v-email"
                    type="email"
                    placeholder="staff@instigenie.in"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isPending}
                    className="bg-slate-950 border-slate-800 text-slate-50 placeholder:text-slate-600"
                  />
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
                  <Mail className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">Check your inbox.</p>
                    <p className="text-slate-400 leading-snug">
                      If a vendor account exists for{" "}
                      <strong className="text-slate-200">{email}</strong>,
                      we just sent it a reset link. The link expires in 1 hour.
                    </p>
                  </div>
                </div>

                {devResetUrl && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1.5">
                    <p className="font-semibold">Dev shortcut</p>
                    <p>Production strips this. In dev:</p>
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
                href="/vendor-admin/login"
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                ← Back to sign-in
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-600">
          Instigenie Vendor Console · /vendor-admin/forgot-password
        </p>
      </div>
    </div>
  );
}
