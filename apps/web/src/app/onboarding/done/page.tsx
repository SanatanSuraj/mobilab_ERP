"use client";

/**
 * /onboarding/done — Phase 4c, the completion screen.
 *
 * Three things happen here:
 *   1. Big "you did it" moment — shows the percent and the confirmation
 *      that the admin has actually run their first cycle.
 *   2. Feedback pulse — three buttons (Yes / Somewhat / No) plus an
 *      optional comment. POST /onboarding/feedback. Append-only on the
 *      backend, so a user who second-guesses can submit again.
 *   3. CTA → /dashboard.
 *
 * We don't gate the dashboard on feedback being submitted — the rule
 * is "no dead ends". Even if the backend is unhappy with the feedback
 * row, the user can still proceed.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  PartyPopper,
  ArrowRight,
  Check,
  ThumbsUp,
  ThumbsDown,
  Meh,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  apiGetOnboarding,
  apiSubmitOnboardingFeedback,
} from "@/lib/api/onboarding";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import type {
  OnboardingEase,
  OnboardingProgress,
} from "@instigenie/contracts";

const POST_DONE_HREF = "/dashboard";

export default function OnboardingDonePage() {
  const router = useRouter();
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [easy, setEasy] = useState<OnboardingEase | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiGetOnboarding()
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          router.replace("/onboarding/start");
          return;
        }
        setProgress(p);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiProblem && err.problem.status === 401) {
          router.replace(`/auth/login?from=${encodeURIComponent("/onboarding/done")}`);
          return;
        }
        if (err instanceof ApiProblem && err.problem.status === 403) {
          router.replace("/dashboard");
          return;
        }
        setBootError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmitFeedback(e: React.FormEvent) {
    e.preventDefault();
    if (!easy || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiSubmitOnboardingFeedback({
        easy,
        comment: comment.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiProblem) {
        setSubmitError(err.problem.detail ?? err.problem.title ?? "Could not save feedback");
      } else {
        setSubmitError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (bootError || !progress) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Couldn&apos;t load completion screen</p>
                <p className="text-sm text-neutral-500 mt-1">
                  {bootError ?? "Onboarding state is missing"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => router.replace(POST_DONE_HREF)}
                >
                  Go to dashboard
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Hero */}
        <Card className="mb-6 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
          <CardContent className="pt-8 pb-8">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="h-16 w-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <PartyPopper className="h-8 w-8" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  🎉 You&apos;ve successfully run your business on ERP
                </h1>
                <p className="text-sm text-neutral-600 mt-2 max-w-md">
                  Your first order, invoice, and payment are recorded. Customers, vendors, and
                  team members are set up. You&apos;re officially live.
                </p>
              </div>
              <div className="flex items-center gap-6 text-xs text-neutral-500 border-t border-neutral-200 pt-4 mt-2 w-full justify-center">
                <span>{progress.percentComplete}% complete</span>
                <span>·</span>
                <span>{progress.stepsCompleted.length} steps done</span>
                <span>·</span>
                <span>
                  Started {new Date(progress.startedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Feedback */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-base font-medium">One quick question — was onboarding easy?</h2>
            <p className="text-xs text-neutral-500 mt-1">
              We read every response. Helps us focus the next round of polish.
            </p>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="flex items-center gap-2 text-sm text-emerald-700">
                <Check className="h-4 w-4" />
                Thanks — your feedback has been recorded.
              </div>
            ) : (
              <form onSubmit={onSubmitFeedback} className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <EaseButton
                    icon={<ThumbsUp className="h-5 w-5" />}
                    label="Yes"
                    selected={easy === "YES"}
                    tone="emerald"
                    onClick={() => setEasy("YES")}
                  />
                  <EaseButton
                    icon={<Meh className="h-5 w-5" />}
                    label="Somewhat"
                    selected={easy === "SOMEWHAT"}
                    tone="amber"
                    onClick={() => setEasy("SOMEWHAT")}
                  />
                  <EaseButton
                    icon={<ThumbsDown className="h-5 w-5" />}
                    label="No"
                    selected={easy === "NO"}
                    tone="rose"
                    onClick={() => setEasy("NO")}
                  />
                </div>

                <div>
                  <Label htmlFor="comment" className="text-xs uppercase tracking-wide text-neutral-500">
                    Anything to add? (optional)
                  </Label>
                  <textarea
                    id="comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    maxLength={4096}
                    placeholder="What worked? What got in the way?"
                    className="mt-1.5 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900 resize-none"
                  />
                  <p className="text-[10px] text-neutral-400 mt-1 text-right">
                    {comment.length} / 4096
                  </p>
                </div>

                {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                <Button type="submit" disabled={!easy || submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit feedback"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Final CTA — never blocked on feedback */}
        <div className="flex justify-center">
          <Button size="lg" onClick={() => router.push(POST_DONE_HREF)}>
            Go to your dashboard
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <p className="text-xs text-neutral-400 mt-6 text-center">
          Need help? Visit Help → Documentation, or email support@instigenie.local.
        </p>
      </div>
    </div>
  );
}

function EaseButton({
  icon,
  label,
  selected,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  selected: boolean;
  tone: "emerald" | "amber" | "rose";
  onClick: () => void;
}) {
  const toneClasses = {
    emerald: selected
      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
      : "border-neutral-200 hover:border-emerald-300 text-neutral-600",
    amber: selected
      ? "border-amber-500 bg-amber-50 text-amber-700"
      : "border-neutral-200 hover:border-amber-300 text-neutral-600",
    rose: selected
      ? "border-rose-500 bg-rose-50 text-rose-700"
      : "border-neutral-200 hover:border-rose-300 text-neutral-600",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex flex-col items-center gap-2 py-4 rounded-lg border-2 transition-colors ${toneClasses[tone]}`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
