"use client";

/**
 * /onboarding/setup — Phase 2 of the guided post-invite setup.
 *
 * 4-step wizard, in this fixed order: Products → Customer → Vendor → Warehouse.
 *
 *   - On mount we GET /onboarding. If the row doesn't exist (admin
 *     navigated here directly), bounce to /onboarding/start.
 *   - Each step renders a small list of existing rows (so the admin
 *     can see what's there — sample data shows up here when picked
 *     in step 1) plus an inline "Add" form. Editing is intentionally
 *     out-of-scope for this wizard; the admin can use the full module
 *     pages later. The wizard's job is "have at least one of each".
 *   - "Mark step complete & continue" calls POST /onboarding/progress
 *     and advances. Idempotent server-side, so a double-click can't
 *     misorder anything.
 *   - The "current" step is the first one in canonical order whose
 *     key isn't in `stepsCompleted`. Earlier completed steps are
 *     re-clickable for review; later ones are locked until each
 *     prior one is checked.
 *
 * When all 4 steps are checked we redirect to /onboarding/first-flow
 * (Stage 3 placeholder; until that ships, /dashboard is fine — the
 * progress row records where we are).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Check,
  Lock,
  Plus,
  Package,
  Users,
  Truck,
  Warehouse as WarehouseIcon,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  apiGetOnboarding,
  apiMarkOnboardingStep,
} from "@/lib/api/onboarding";
import {
  apiListItems,
  apiCreateItem,
  apiListWarehouses,
  apiCreateWarehouse,
} from "@/lib/api/inventory";
import { apiListAccounts, apiCreateAccount } from "@/lib/api/crm";
import { apiListVendors, apiCreateVendor } from "@/lib/api/procurement";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import type {
  Account,
  Item,
  OnboardingProgress,
  OnboardingStep,
  Vendor,
  Warehouse,
} from "@instigenie/contracts";

const NEXT_STAGE_HREF = "/onboarding/first-flow"; // Stage 3 placeholder

interface StepDef {
  key: OnboardingStep; // server-side step key
  title: string;
  blurb: string;
  icon: React.ReactNode;
}

// Wizard order — does not have to match `ONBOARDING_STEPS` order from
// the contracts barrel. The contracts list is canonical for percent
// math; this list is canonical for the UI.
const WIZARD_STEPS: StepDef[] = [
  {
    key: "product_added",
    title: "Products",
    blurb: "Add at least one product or item that you sell or stock.",
    icon: <Package className="h-4 w-4" />,
  },
  {
    key: "customer_added",
    title: "Customer",
    blurb: "Add at least one customer (account) you sell to.",
    icon: <Users className="h-4 w-4" />,
  },
  {
    key: "vendor_added",
    title: "Vendor",
    blurb: "Add at least one vendor (supplier) you buy from.",
    icon: <Truck className="h-4 w-4" />,
  },
  {
    key: "warehouse_added",
    title: "Warehouse",
    blurb: "Add at least one warehouse to track inventory.",
    icon: <WarehouseIcon className="h-4 w-4" />,
  },
];

export default function OnboardingSetupPage() {
  const router = useRouter();
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  // index in WIZARD_STEPS the user is currently viewing (may be a
  // completed step they clicked back into for review).
  const [activeIndex, setActiveIndex] = useState(0);

  // Initial load — fetch progress; if missing, send to /start.
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
        setActiveIndex(firstIncompleteIndex(p.stepsCompleted));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiProblem && err.problem.status === 401) {
          router.replace(`/auth/login?from=${encodeURIComponent("/onboarding/setup")}`);
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

  // When all 4 wizard steps are done, advance to the next stage.
  useEffect(() => {
    if (!progress) return;
    if (WIZARD_STEPS.every((s) => progress.stepsCompleted.includes(s.key))) {
      router.replace(NEXT_STAGE_HREF);
    }
  }, [progress, router]);

  const completedCount = useMemo(() => {
    if (!progress) return 0;
    return WIZARD_STEPS.filter((s) =>
      progress.stepsCompleted.includes(s.key),
    ).length;
  }, [progress]);

  const wizardPercent = Math.round((completedCount / WIZARD_STEPS.length) * 100);

  async function markStepDone(step: OnboardingStep) {
    const next = await apiMarkOnboardingStep({ step });
    setProgress(next);
    setActiveIndex(firstIncompleteIndex(next.stepsCompleted));
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
                <p className="font-medium text-sm">Couldn&apos;t load setup</p>
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

  const activeStep = WIZARD_STEPS[activeIndex]!;

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Header + progress bar */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">
            Set up your data
          </h1>
          <p className="text-sm text-neutral-500 mb-4">
            Add at least one of each. You can rename or expand later from the main app.
          </p>
          <div className="h-2 bg-neutral-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-neutral-900 transition-all duration-300"
              style={{ width: `${wizardPercent}%` }}
              aria-valuenow={wizardPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              role="progressbar"
              aria-label="Setup progress"
            />
          </div>
          <p className="text-xs text-neutral-400 mt-2">
            {completedCount} of {WIZARD_STEPS.length} steps complete · {wizardPercent}%
          </p>
        </div>

        {/* Step pills */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {WIZARD_STEPS.map((s, i) => {
            const done = progress.stepsCompleted.includes(s.key);
            const current = i === activeIndex;
            const reachable = done || i === firstIncompleteIndex(progress.stepsCompleted);
            return (
              <button
                key={s.key}
                onClick={() => reachable && setActiveIndex(i)}
                disabled={!reachable}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  current
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : done
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300"
                      : reachable
                        ? "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                        : "border-neutral-200 bg-neutral-100 text-neutral-400 cursor-not-allowed"
                }`}
                aria-current={current ? "step" : undefined}
              >
                {done ? <Check className="h-3 w-3" /> : !reachable ? <Lock className="h-3 w-3" /> : s.icon}
                <span>{s.title}</span>
              </button>
            );
          })}
        </div>

        {/* Active step body */}
        <StepBody
          key={activeStep.key /* remount on switch — drops any half-typed form state */}
          step={activeStep}
          alreadyComplete={progress.stepsCompleted.includes(activeStep.key)}
          onComplete={() => markStepDone(activeStep.key)}
        />
      </div>
    </div>
  );
}

// ─── Per-step body ───────────────────────────────────────────────────────────

function StepBody({
  step,
  alreadyComplete,
  onComplete,
}: {
  step: StepDef;
  alreadyComplete: boolean;
  onComplete: () => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium">{step.title}</h2>
            <p className="text-xs text-neutral-500 mt-0.5">{step.blurb}</p>
          </div>
          {alreadyComplete && (
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              <Check className="h-3 w-3 mr-1" />
              Complete
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {step.key === "product_added" && (
          <ProductsStep alreadyComplete={alreadyComplete} onComplete={onComplete} />
        )}
        {step.key === "customer_added" && (
          <CustomerStep alreadyComplete={alreadyComplete} onComplete={onComplete} />
        )}
        {step.key === "vendor_added" && (
          <VendorStep alreadyComplete={alreadyComplete} onComplete={onComplete} />
        )}
        {step.key === "warehouse_added" && (
          <WarehouseStep alreadyComplete={alreadyComplete} onComplete={onComplete} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Step 1 — Products ───────────────────────────────────────────────────────

function ProductsStep({
  alreadyComplete,
  onComplete,
}: {
  alreadyComplete: boolean;
  onComplete: () => Promise<void>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void apiListItems({ limit: 5 })
      .then((r) => !cancelled && setItems(r.data))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiCreateItem({
        sku: sku.trim(),
        name: name.trim(),
        category: "FINISHED_GOOD",
        uom: "EA",
        unitCost: "0",
        isSerialised: false,
        isBatched: false,
        isActive: true,
      });
      setSku("");
      setName("");
      setShowAdd(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canContinue = alreadyComplete || items.length > 0;

  return (
    <div className="space-y-4">
      <ItemList
        items={items.map((i) => ({ id: i.id, primary: i.name, secondary: i.sku }))}
        emptyHint="No products yet — add one below."
      />

      {showAdd ? (
        <form onSubmit={onAdd} className="space-y-3 border rounded-lg p-3 bg-neutral-50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-0001" required maxLength={64} />
            </div>
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" required maxLength={200} />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add product"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add another product
        </Button>
      )}

      <ContinueButton
        canContinue={canContinue}
        alreadyComplete={alreadyComplete}
        onClick={onComplete}
      />
    </div>
  );
}

// ─── Step 2 — Customer ───────────────────────────────────────────────────────

function CustomerStep({
  alreadyComplete,
  onComplete,
}: {
  alreadyComplete: boolean;
  onComplete: () => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void apiListAccounts({ limit: 5 })
      .then((r) => !cancelled && setAccounts(r.data))
      .catch(() => !cancelled && setAccounts([]));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiCreateAccount({
        name: name.trim(),
        country: "IN",
        healthScore: 50,
        isKeyAccount: false,
      });
      setName("");
      setShowAdd(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canContinue = alreadyComplete || accounts.length > 0;

  return (
    <div className="space-y-4">
      <ItemList
        items={accounts.map((a) => ({ id: a.id, primary: a.name, secondary: a.gstin ?? a.email ?? "—" }))}
        emptyHint="No customers yet — add one below."
      />

      {showAdd ? (
        <form onSubmit={onAdd} className="space-y-3 border rounded-lg p-3 bg-neutral-50">
          <div>
            <Label htmlFor="cust-name">Customer name</Label>
            <Input id="cust-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" required maxLength={200} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add customer"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add another customer
        </Button>
      )}

      <ContinueButton
        canContinue={canContinue}
        alreadyComplete={alreadyComplete}
        onClick={onComplete}
      />
    </div>
  );
}

// ─── Step 3 — Vendor ─────────────────────────────────────────────────────────

function VendorStep({
  alreadyComplete,
  onComplete,
}: {
  alreadyComplete: boolean;
  onComplete: () => Promise<void>;
}) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void apiListVendors({ limit: 5 })
      .then((r) => !cancelled && setVendors(r.data))
      .catch(() => !cancelled && setVendors([]));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiCreateVendor({
        code: code.trim(),
        name: name.trim(),
        vendorType: "SUPPLIER",
        country: "IN",
        paymentTermsDays: 30,
        creditLimit: "0",
        isMsme: false,
        isActive: true,
      });
      setCode("");
      setName("");
      setShowAdd(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canContinue = alreadyComplete || vendors.length > 0;

  return (
    <div className="space-y-4">
      <ItemList
        items={vendors.map((v) => ({ id: v.id, primary: v.name, secondary: v.code }))}
        emptyHint="No vendors yet — add one below."
      />

      {showAdd ? (
        <form onSubmit={onAdd} className="space-y-3 border rounded-lg p-3 bg-neutral-50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ven-code">Code</Label>
              <Input id="ven-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="V-0001" required maxLength={32} />
            </div>
            <div>
              <Label htmlFor="ven-name">Name</Label>
              <Input id="ven-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" required maxLength={200} />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add vendor"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add another vendor
        </Button>
      )}

      <ContinueButton
        canContinue={canContinue}
        alreadyComplete={alreadyComplete}
        onClick={onComplete}
      />
    </div>
  );
}

// ─── Step 4 — Warehouse ──────────────────────────────────────────────────────

function WarehouseStep({
  alreadyComplete,
  onComplete,
}: {
  alreadyComplete: boolean;
  onComplete: () => Promise<void>;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void apiListWarehouses({ limit: 5 })
      .then((r) => !cancelled && setWarehouses(r.data))
      .catch(() => !cancelled && setWarehouses([]));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiCreateWarehouse({
        code: code.trim(),
        name: name.trim(),
        kind: "PRIMARY",
        country: "IN",
        isDefault: warehouses.length === 0,
        isActive: true,
      });
      setCode("");
      setName("");
      setShowAdd(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canContinue = alreadyComplete || warehouses.length > 0;

  return (
    <div className="space-y-4">
      <ItemList
        items={warehouses.map((w) => ({ id: w.id, primary: w.name, secondary: w.code }))}
        emptyHint="No warehouses yet — add one below."
      />

      {showAdd ? (
        <form onSubmit={onAdd} className="space-y-3 border rounded-lg p-3 bg-neutral-50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wh-code">Code</Label>
              <Input id="wh-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="WH-MAIN" required maxLength={32} />
            </div>
            <div>
              <Label htmlFor="wh-name">Name</Label>
              <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" required maxLength={200} />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add warehouse"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add another warehouse
        </Button>
      )}

      <ContinueButton
        canContinue={canContinue}
        alreadyComplete={alreadyComplete}
        onClick={onComplete}
        label="Finish setup"
      />
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function ItemList({
  items,
  emptyHint,
}: {
  items: Array<{ id: string; primary: string; secondary: string }>;
  emptyHint: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-neutral-500 italic">{emptyHint}</p>;
  }
  return (
    <ul className="divide-y divide-neutral-200 rounded-lg border bg-white">
      {items.map((it) => (
        <li key={it.id} className="px-3 py-2 flex items-center justify-between text-sm">
          <span className="font-medium">{it.primary}</span>
          <span className="text-neutral-500 text-xs">{it.secondary}</span>
        </li>
      ))}
    </ul>
  );
}

function ContinueButton({
  canContinue,
  alreadyComplete,
  onClick,
  label,
}: {
  canContinue: boolean;
  alreadyComplete: boolean;
  onClick: () => Promise<void>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function handle() {
    if (!canContinue || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onClick();
    } catch (e) {
      setErr(extractError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pt-2">
      <Button onClick={handle} disabled={!canContinue || busy} className="w-full">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {label ?? (alreadyComplete ? "Continue" : "Mark complete & continue")}
            <ArrowRight className="h-4 w-4 ml-1" />
          </>
        )}
      </Button>
      {!canContinue && (
        <p className="text-xs text-neutral-500 mt-2 text-center">
          Add at least one entry to continue.
        </p>
      )}
      {err && <p className="text-xs text-red-600 mt-2 text-center">{err}</p>}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function firstIncompleteIndex(stepsCompleted: OnboardingStep[]): number {
  for (let i = 0; i < WIZARD_STEPS.length; i++) {
    if (!stepsCompleted.includes(WIZARD_STEPS[i]!.key)) return i;
  }
  return WIZARD_STEPS.length - 1;
}

function extractError(err: unknown): string {
  if (err instanceof ApiProblem) {
    return err.problem.detail ?? err.problem.title ?? "Request failed";
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
