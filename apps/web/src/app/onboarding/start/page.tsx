"use client";

/**
 * /onboarding/start — Phase 1 of the guided post-invite setup.
 *
 * Pre-conditions (enforced upstream, not here):
 *   - Vendor-admin has provisioned the tenant + admin user-invitation.
 *   - Admin accepted the invite at /auth/accept-invite and has a valid
 *     internal-audience JWT in sessionStorage.
 *
 * On mount we GET /onboarding — if a row already exists, the wizard
 * has been started before (refresh, second tab, etc.) and we route the
 * admin straight on to the next step. Otherwise we render the form.
 *
 * The form has two questions:
 *   1. Industry — drives whether the wizard later shows the production
 *      track (work orders, BOMs) or the trading track (inventory
 *      movements only). Both are valid post-MVP; for now the choice
 *      is recorded so we can branch later without a migration.
 *   2. "Use sample data" — when true, the backend seeds 1 warehouse,
 *      1 item, 1 customer, 1 vendor inside the same transaction as the
 *      progress row, and pre-marks those four steps complete.
 *
 * On success we redirect to /onboarding/setup (Stage 2). For now that
 * page is the next-stage placeholder; until it ships, the route lands
 * on /dashboard, which is fine — the progress row records where we are.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2, Factory, ShoppingCart, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  apiGetOnboarding,
  apiStartOnboarding,
} from "@/lib/api/onboarding";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import type { OnboardingIndustry } from "@instigenie/contracts";

const NEXT_STEP_HREF = "/onboarding/setup"; // Stage 2 wizard page (placeholder)

export default function OnboardingStartPage() {
  const router = useRouter();

  const [bootstrapping, setBootstrapping] = useState(true);
  const [industry, setIndustry] = useState<OnboardingIndustry>("MANUFACTURING");
  const [useSampleData, setUseSampleData] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If onboarding has already been started for this org, skip the form.
  useEffect(() => {
    let cancelled = false;
    void apiGetOnboarding()
      .then((existing) => {
        if (cancelled) return;
        if (existing) {
          router.replace(NEXT_STEP_HREF);
          return;
        }
        setBootstrapping(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // 401 → not logged in or session expired. Bounce to login.
        if (err instanceof ApiProblem && err.problem.status === 401) {
          router.replace(`/auth/login?from=${encodeURIComponent("/onboarding/start")}`);
          return;
        }
        // 403 → logged in but not admin. Send to the dashboard.
        if (err instanceof ApiProblem && err.problem.status === 403) {
          router.replace("/dashboard");
          return;
        }
        // Anything else: show the form anyway and let the submit handle
        // the real error. Better than a permanent spinner.
        setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiStartOnboarding({ industry, useSampleData });
      router.push(NEXT_STEP_HREF);
    } catch (err) {
      if (err instanceof ApiProblem) {
        setError(err.problem.detail ?? err.problem.title ?? "Could not start onboarding");
      } else if (err instanceof Error && err.message.includes("Failed to fetch")) {
        setError("Could not reach the API. Is it running on :4000?");
      } else {
        setError("Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  if (bootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-14 w-14 rounded-2xl bg-neutral-900 text-white flex items-center justify-center">
            <FlaskConical className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Instigenie ERP</h1>
          <p className="text-neutral-500 text-sm">Let&apos;s get your workspace set up — takes about a minute.</p>
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">1 of 3 — Tell us about your business</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-6">
              {/* Industry — radio cards for clarity. */}
              <fieldset>
                <legend className="text-sm font-medium mb-2">What does your business do?</legend>
                <div className="grid grid-cols-2 gap-3">
                  <IndustryCard
                    icon={<Factory className="h-5 w-5" />}
                    title="Manufacturing"
                    blurb="We make products from raw materials"
                    selected={industry === "MANUFACTURING"}
                    onSelect={() => setIndustry("MANUFACTURING")}
                  />
                  <IndustryCard
                    icon={<ShoppingCart className="h-5 w-5" />}
                    title="Trading"
                    blurb="We buy and sell finished goods"
                    selected={industry === "TRADING"}
                    onSelect={() => setIndustry("TRADING")}
                  />
                </div>
              </fieldset>

              {/* Sample-data toggle. */}
              <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3">
                <Checkbox
                  id="use-sample-data"
                  checked={useSampleData}
                  onCheckedChange={(v) => setUseSampleData(v === true)}
                />
                <div className="flex-1">
                  <Label htmlFor="use-sample-data" className="cursor-pointer flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Pre-fill with sample data
                  </Label>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Adds 1 warehouse, 1 product, 1 customer, and 1 vendor so you can try a full order
                    cycle right away. You can rename or delete them anytime.
                  </p>
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-neutral-400 mt-6">
          Instigenie ERP · Onboarding · Step 1
        </p>
      </div>
    </div>
  );
}

function IndustryCard({
  icon,
  title,
  blurb,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`text-left rounded-lg border p-3 transition-colors ${
        selected
          ? "border-neutral-900 bg-neutral-50 ring-2 ring-neutral-900/10"
          : "border-neutral-200 bg-white hover:border-neutral-300"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={selected ? "text-neutral-900" : "text-neutral-500"}>{icon}</span>
        <span className="font-medium text-sm">{title}</span>
      </div>
      <p className="text-xs text-neutral-500">{blurb}</p>
    </button>
  );
}
