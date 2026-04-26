"use client";

/**
 * /onboarding/first-flow — Phase 3 of the guided post-invite setup.
 *
 * 6-step business-cycle checklist. Order matters because real ERP flow
 * has dependencies (you can't post a GRN without a PO, can't invoice
 * without an SO, can't take payment without an invoice). The wizard
 * doesn't *enforce* dependency — the underlying APIs do — it just
 * presents the steps in the order a real first transaction would
 * touch them so a brand-new admin can't get lost.
 *
 *   1. Sales Order        (tracked: first_so_created)
 *   2. Work Order         (manufacturing only, NOT server-tracked)
 *   3. Purchase Order     (NOT server-tracked)
 *   4. GRN                (NOT server-tracked)
 *   5. Sales Invoice      (tracked: first_invoice_created)
 *   6. Payment            (tracked: first_payment_recorded)
 *
 * Of the 6, only 3 step keys exist in `ONBOARDING_STEPS` (the contracts
 * union) — the others are intermediate guidance that's useful for the
 * UI but not load-bearing for "is this org onboarded?". We auto-detect
 * each step's completion by polling the underlying list endpoint
 * (does the org have ≥1 sales order? ≥1 invoice? etc.) on mount and
 * on window-focus so when the admin clicks "Go to Sales Orders",
 * creates one in another module page, then comes back, the checkbox
 * flips on its own — no manual "I'm done" button.
 *
 * For the 3 server-tracked steps, the auto-detect ALSO calls
 * `POST /onboarding/progress` so the row reflects truth. Idempotent
 * server-side, so duplicate calls during a re-focus storm are fine.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Check,
  Lock,
  ArrowRight,
  ExternalLink,
  AlertCircle,
  ShoppingBag,
  Hammer,
  ClipboardList,
  PackageCheck,
  ReceiptText,
  Wallet,
  PartyPopper,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  apiGetOnboarding,
  apiMarkOnboardingStep,
} from "@/lib/api/onboarding";
import { apiListSalesOrders } from "@/lib/api/crm";
import { apiListWorkOrders } from "@/lib/api/production";
import { apiListPurchaseOrders, apiListGrns } from "@/lib/api/procurement";
import { apiListSalesInvoices, apiListPayments } from "@/lib/api/finance";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import type {
  OnboardingProgress,
  OnboardingStep,
} from "@instigenie/contracts";

// Post-flow chain: → team invites → portal user → completion screen → dashboard.
const POST_FLOW_HREF = "/onboarding/team";

interface FlowStep {
  id: string; // local id; not the same as server step key
  serverStep: OnboardingStep | null; // null = local-only (no progress write)
  title: string;
  blurb: string;
  icon: React.ReactNode;
  goToHref: string;
  goToLabel: string;
  /** Manufacturing-only step is skipped when industry === TRADING. */
  manufacturingOnly?: boolean;
  /**
   * Returns true if the org has at least one row of this entity type.
   * Used by the auto-detect poll.
   */
  detect: () => Promise<boolean>;
}

const FLOW_STEPS: FlowStep[] = [
  {
    id: "sales_order",
    serverStep: "first_so_created",
    title: "Create your first Sales Order",
    blurb: "Capture an order from a customer. The starting point of every revenue cycle.",
    icon: <ShoppingBag className="h-4 w-4" />,
    goToHref: "/crm/sales-orders",
    goToLabel: "Open Sales Orders",
    detect: async () => {
      const r = await apiListSalesOrders({ limit: 1 });
      return r.data.length > 0;
    },
  },
  {
    id: "work_order",
    serverStep: null,
    manufacturingOnly: true,
    title: "Release a Work Order",
    blurb: "Production gets a kit-list and a deadline. Skip if you only trade finished goods.",
    icon: <Hammer className="h-4 w-4" />,
    goToHref: "/production/work-orders",
    goToLabel: "Open Work Orders",
    detect: async () => {
      const r = await apiListWorkOrders({ limit: 1 });
      return r.data.length > 0;
    },
  },
  {
    id: "purchase_order",
    serverStep: null,
    title: "Raise a Purchase Order",
    blurb: "Buy raw materials or stock. Send the PO to your vendor.",
    icon: <ClipboardList className="h-4 w-4" />,
    goToHref: "/procurement/purchase-orders",
    goToLabel: "Open Purchase Orders",
    detect: async () => {
      const r = await apiListPurchaseOrders({ limit: 1 });
      return r.data.length > 0;
    },
  },
  {
    id: "grn",
    serverStep: null,
    title: "Receive goods (GRN)",
    blurb: "Vendor delivered. Post a Goods Receipt Note — stock goes up, AP gets noticed.",
    icon: <PackageCheck className="h-4 w-4" />,
    goToHref: "/inventory/grn",
    goToLabel: "Open GRN",
    detect: async () => {
      const r = await apiListGrns({ limit: 1 });
      return r.data.length > 0;
    },
  },
  {
    id: "invoice",
    serverStep: "first_invoice_created",
    title: "Generate a Sales Invoice",
    blurb: "Bill the customer. Once posted it locks into the AR ledger.",
    icon: <ReceiptText className="h-4 w-4" />,
    goToHref: "/finance/sales-invoices",
    goToLabel: "Open Invoices",
    detect: async () => {
      const r = await apiListSalesInvoices({ limit: 1 });
      return r.data.length > 0;
    },
  },
  {
    id: "payment",
    serverStep: "first_payment_recorded",
    title: "Record a Payment",
    blurb: "Customer paid. Settle the invoice — the AR ledger and the bank line up.",
    icon: <Wallet className="h-4 w-4" />,
    goToHref: "/finance/payments",
    goToLabel: "Open Payments",
    detect: async () => {
      const r = await apiListPayments({ limit: 1 });
      return r.data.length > 0;
    },
  },
];

const SETUP_STEPS: OnboardingStep[] = [
  "warehouse_added",
  "product_added",
  "customer_added",
  "vendor_added",
];

export default function OnboardingFirstFlowPage() {
  const router = useRouter();
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Local detection cache: stepId → done?
  const [localDone, setLocalDone] = useState<Record<string, boolean>>({});
  const [polling, setPolling] = useState(false);
  // Stable ref for the latest progress, so the auto-mark effect doesn't
  // need it in deps and re-fire spuriously.
  const progressRef = useRef<OnboardingProgress | null>(null);
  progressRef.current = progress;

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    void apiGetOnboarding()
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          router.replace("/onboarding/start");
          return;
        }
        // Gate: setup must be done first. If not, bounce to /setup.
        if (!SETUP_STEPS.every((s) => p.stepsCompleted.includes(s))) {
          router.replace("/onboarding/setup");
          return;
        }
        setProgress(p);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiProblem && err.problem.status === 401) {
          router.replace(`/auth/login?from=${encodeURIComponent("/onboarding/first-flow")}`);
          return;
        }
        if (err instanceof ApiProblem && err.problem.status === 403) {
          router.replace("/dashboard");
          return;
        }
        setBootError(err instanceof Error ? err.message : "Failed to load onboarding state");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Poll all detect() helpers and (for server-tracked steps) persist
  // the new completion via /onboarding/progress. Runs on mount and on
  // every window focus so when the admin returns from another tab the
  // checklist updates without a refresh.
  const refresh = useCallback(async () => {
    const cur = progressRef.current;
    if (!cur) return;
    setPolling(true);
    try {
      const visibleSteps = FLOW_STEPS.filter(
        (s) => !s.manufacturingOnly || cur.industry === "MANUFACTURING",
      );
      const results = await Promise.all(
        visibleSteps.map(async (s) => ({
          step: s,
          done: await s.detect().catch(() => false),
        })),
      );
      const nextLocal: Record<string, boolean> = {};
      let latest = cur;
      for (const { step, done } of results) {
        nextLocal[step.id] = done;
        // For server-tracked steps that flipped to done and aren't
        // already persisted, write through. Sequential rather than
        // parallel so the response we keep is the latest.
        if (
          done &&
          step.serverStep !== null &&
          !latest.stepsCompleted.includes(step.serverStep)
        ) {
          try {
            latest = await apiMarkOnboardingStep({ step: step.serverStep });
          } catch {
            // Best-effort — a transient failure here just means we'll
            // retry on the next focus event.
          }
        }
      }
      setLocalDone(nextLocal);
      if (latest !== cur) {
        progressRef.current = latest;
        setProgress(latest);
      }
    } finally {
      setPolling(false);
    }
  }, []);

  useEffect(() => {
    if (!progress) return;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [progress, refresh]);

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
                <p className="font-medium text-sm">Couldn&apos;t load your first-flow checklist</p>
                <p className="text-sm text-neutral-500 mt-1">
                  {bootError ?? "Onboarding state is missing"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => router.replace("/onboarding/start")}
                >
                  Restart onboarding
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const visibleSteps = FLOW_STEPS.filter(
    (s) => !s.manufacturingOnly || progress.industry === "MANUFACTURING",
  );
  const completedCount = visibleSteps.filter((s) => isStepDone(s, progress, localDone)).length;
  const allDone = completedCount === visibleSteps.length;
  const percent = Math.round((completedCount / visibleSteps.length) * 100);
  const currentIndex = visibleSteps.findIndex(
    (s) => !isStepDone(s, progress, localDone),
  );

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">
            Run your first business cycle
          </h1>
          <p className="text-sm text-neutral-500 mb-4">
            Walk through one full order → invoice → payment so you know the system end-to-end.
            Each step opens the real module page — no shortcuts.
          </p>
          <div className="h-2 bg-neutral-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-neutral-900 transition-all duration-300"
              style={{ width: `${percent}%` }}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              role="progressbar"
              aria-label="First-flow progress"
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-neutral-400">
              {completedCount} of {visibleSteps.length} complete · {percent}%
            </p>
            <button
              onClick={() => void refresh()}
              disabled={polling}
              className="text-xs text-neutral-500 hover:text-neutral-700 disabled:opacity-50"
            >
              {polling ? "Checking…" : "Refresh status"}
            </button>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {visibleSteps.map((step, i) => {
            const done = isStepDone(step, progress, localDone);
            const isCurrent = i === currentIndex;
            const locked = !done && i > currentIndex;
            return (
              <StepRow
                key={step.id}
                step={step}
                done={done}
                isCurrent={isCurrent}
                locked={locked}
              />
            );
          })}
        </div>

        {/* Done CTA */}
        {allDone && (
          <Card className="mt-8 border-emerald-200 bg-emerald-50">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <PartyPopper className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold">You&apos;re fully onboarded</h3>
                  <p className="text-sm text-neutral-600 mt-1">
                    Your first order, invoice, and payment are recorded.
                    The dashboard is your day-to-day from here.
                  </p>
                </div>
                <Button onClick={() => router.push(POST_FLOW_HREF)}>
                  Go to dashboard
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-neutral-400 mt-6 text-center">
          Tip: open each module in this same tab. We&apos;ll automatically tick the box
          when you come back.
        </p>
      </div>
    </div>
  );
}

function StepRow({
  step,
  done,
  isCurrent,
  locked,
}: {
  step: FlowStep;
  done: boolean;
  isCurrent: boolean;
  locked: boolean;
}) {
  return (
    <Card
      className={`transition-colors ${
        isCurrent
          ? "border-neutral-900 ring-2 ring-neutral-900/10"
          : done
            ? "border-emerald-200 bg-emerald-50/30"
            : "border-neutral-200"
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {/* Status indicator */}
          <div className="mt-0.5">
            {done ? (
              <div className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Check className="h-3.5 w-3.5" />
              </div>
            ) : locked ? (
              <div className="h-6 w-6 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center">
                <Lock className="h-3.5 w-3.5" />
              </div>
            ) : (
              <div className="h-6 w-6 rounded-full border-2 border-neutral-900 flex items-center justify-center">
                <span className="text-xs font-semibold">→</span>
              </div>
            )}
          </div>
          {/* Body */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={done ? "text-emerald-700" : locked ? "text-neutral-400" : "text-neutral-900"}>
                {step.icon}
              </span>
              <h3 className={`font-medium text-sm ${locked ? "text-neutral-400" : ""}`}>
                {step.title}
              </h3>
              {done && (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 border-emerald-200">
                  Done
                </Badge>
              )}
              {step.serverStep === null && !done && !locked && (
                <Badge variant="outline" className="text-[10px] text-neutral-500">
                  optional
                </Badge>
              )}
            </div>
            <p className="text-xs text-neutral-500 mb-3">{step.blurb}</p>
            {!done &&
              (locked ? (
                <Button size="sm" variant="outline" disabled>
                  <Lock className="h-3.5 w-3.5 mr-1" />
                  Complete previous steps first
                </Button>
              ) : (
                <a
                  href={step.goToHref}
                  className={buttonVariants({
                    size: "sm",
                    variant: isCurrent ? "default" : "outline",
                  })}
                >
                  {step.goToLabel}
                  <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </a>
              ))}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

function isStepDone(
  step: FlowStep,
  progress: OnboardingProgress,
  localDone: Record<string, boolean>,
): boolean {
  // Server-tracked → trust the progress row (it's the source of truth).
  // Local-only → trust the most recent detect() result.
  if (step.serverStep) {
    return progress.stepsCompleted.includes(step.serverStep);
  }
  return localDone[step.id] === true;
}
