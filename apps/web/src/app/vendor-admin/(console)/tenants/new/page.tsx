"use client";

/**
 * /vendor-admin/tenants/new — provision a brand-new tenant.
 *
 * Vendor-admin only. POST /vendor-admin/tenants in one transaction creates:
 *   - organizations row (TRIAL or ACTIVE depending on whether trialEndsAt is set)
 *   - subscriptions row on the chosen plan
 *   - user_invitations row for the customer's admin (role SUPER_ADMIN)
 *
 * On success we render the dev accept URL (non-prod only) so the vendor
 * admin can hand the link to the customer without SMTP wired up. The
 * customer clicks the URL → /auth/accept-invite → sets a password → lands
 * on /onboarding/start (the wizard built across Stages 1-4).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ArrowLeft,
  Copy,
  Check,
  Building2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiVendorCreateTenant } from "@/lib/api/vendor-admin";
import { ApiProblem } from "@/lib/api/vendor-admin";
import type {
  CreateTenantRequest,
  CreateTenantResponse,
  PlanCode,
} from "@instigenie/contracts";

const PLAN_OPTIONS: Array<{ code: PlanCode; name: string; blurb: string }> = [
  { code: "FREE", name: "Free", blurb: "Single user, evaluation only" },
  { code: "STARTER", name: "Starter", blurb: "Small team, basic modules" },
  { code: "PRO", name: "Pro", blurb: "Production-grade, all modules" },
  { code: "ENTERPRISE", name: "Enterprise", blurb: "SLA + custom limits" },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export default function NewTenantPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [planCode, setPlanCode] = useState<PlanCode>("STARTER");
  const [trialDays, setTrialDays] = useState<number | "">("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateTenantResponse | null>(null);
  const [copied, setCopied] = useState(false);

  function onNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateTenantRequest = {
        name: name.trim(),
        slug: slug.trim() || undefined,
        planCode,
        adminEmail: adminEmail.trim(),
        ...(adminName.trim() ? { adminName: adminName.trim() } : {}),
        ...(typeof trialDays === "number" && trialDays > 0
          ? {
              trialEndsAt: new Date(Date.now() + trialDays * 86400_000)
                .toISOString()
                .slice(0, 10),
            }
          : {}),
      };
      const r = await apiVendorCreateTenant(body);
      setCreated(r);
    } catch (err) {
      if (err instanceof ApiProblem) {
        setError(err.problem.detail ?? err.problem.title ?? "Could not create tenant");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function copyDevUrl() {
    if (!created?.devAcceptUrl) return;
    try {
      await navigator.clipboard.writeText(created.devAcceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => router.push("/vendor-admin/tenants")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to tenants
        </Button>

        <div className="mb-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-neutral-900 text-white flex items-center justify-center">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Onboard a new business</h1>
            <p className="text-sm text-neutral-500">
              Creates the tenant + a subscription + invites the customer admin — one transaction.
            </p>
          </div>
        </div>

        {created ? (
          <SuccessCard
            created={created}
            onCopy={copyDevUrl}
            copied={copied}
            onDone={() => router.push("/vendor-admin/tenants")}
          />
        ) : (
          <Card>
            <CardHeader>
              <h2 className="text-base font-medium">Tenant details</h2>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-5">
                <div>
                  <Label htmlFor="org-name">Company name</Label>
                  <Input
                    id="org-name"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="Acme Industries Pvt Ltd"
                    required
                    maxLength={200}
                  />
                </div>

                <div>
                  <Label htmlFor="org-slug">Slug (URL identifier)</Label>
                  <Input
                    id="org-slug"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase());
                      setSlugTouched(true);
                    }}
                    placeholder="acme-industries"
                    pattern="[a-z0-9]([a-z0-9\-]{0,62}[a-z0-9])?"
                    required
                    maxLength={64}
                  />
                  <p className="text-xs text-neutral-500 mt-1">
                    Lower-case, alphanumeric + dashes. Auto-generated from name.
                  </p>
                </div>

                <fieldset>
                  <legend className="text-sm font-medium mb-2">Plan</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {PLAN_OPTIONS.map((p) => (
                      <button
                        key={p.code}
                        type="button"
                        onClick={() => setPlanCode(p.code)}
                        aria-pressed={planCode === p.code}
                        className={`text-left rounded-lg border p-2.5 transition-colors ${
                          planCode === p.code
                            ? "border-neutral-900 bg-neutral-50"
                            : "border-neutral-200 bg-white hover:border-neutral-300"
                        }`}
                      >
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">{p.blurb}</div>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <Label htmlFor="trial-days">Trial (days, optional)</Label>
                  <Input
                    id="trial-days"
                    type="number"
                    min={0}
                    max={90}
                    value={trialDays}
                    onChange={(e) =>
                      setTrialDays(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="0 (skip — go straight to ACTIVE)"
                  />
                  <p className="text-xs text-neutral-500 mt-1">
                    Empty or 0 → tenant is ACTIVE immediately. Otherwise TRIAL ends in N days.
                  </p>
                </div>

                <div className="border-t pt-4 mt-4 space-y-3">
                  <h3 className="text-sm font-medium">Customer admin</h3>
                  <p className="text-xs text-neutral-500 -mt-2">
                    Will receive a SUPER_ADMIN invite. They set their password on first click.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="admin-email">Email</Label>
                      <Input
                        id="admin-email"
                        type="email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder="founder@acme.com"
                        required
                        maxLength={254}
                      />
                    </div>
                    <div>
                      <Label htmlFor="admin-name">Name (optional)</Label>
                      <Input
                        id="admin-name"
                        value={adminName}
                        onChange={(e) => setAdminName(e.target.value)}
                        placeholder="Their full name"
                        maxLength={120}
                      />
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Create tenant + send invite"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function SuccessCard({
  created,
  onCopy,
  copied,
  onDone,
}: {
  created: CreateTenantResponse;
  onCopy: () => void;
  copied: boolean;
  onDone: () => void;
}) {
  return (
    <Card className="border-emerald-200 bg-emerald-50/30">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <Check className="h-4 w-4" />
          </div>
          <h2 className="text-base font-medium">Tenant created</h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="text-sm space-y-1.5">
          <div className="flex">
            <dt className="w-32 text-neutral-500">Name</dt>
            <dd className="font-medium">{created.tenant.name}</dd>
          </div>
          <div className="flex">
            <dt className="w-32 text-neutral-500">Status</dt>
            <dd>
              <Badge variant="outline">{created.tenant.status}</Badge>
            </dd>
          </div>
          {created.tenant.trialEndsAt && (
            <div className="flex">
              <dt className="w-32 text-neutral-500">Trial ends</dt>
              <dd>{new Date(created.tenant.trialEndsAt).toLocaleDateString()}</dd>
            </div>
          )}
          <div className="flex">
            <dt className="w-32 text-neutral-500">Plan</dt>
            <dd>
              <Badge variant="secondary">{created.subscription.planCode}</Badge>
            </dd>
          </div>
          <div className="flex">
            <dt className="w-32 text-neutral-500">Admin invite</dt>
            <dd className="font-medium">{created.invitation.email}</dd>
          </div>
          <div className="flex">
            <dt className="w-32 text-neutral-500">Invite expires</dt>
            <dd>{new Date(created.invitation.expiresAt).toLocaleString()}</dd>
          </div>
        </dl>

        {created.devAcceptUrl ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium">Dev accept link (non-production only)</p>
                <p className="text-xs text-neutral-600 mt-0.5 mb-2">
                  Send this to {created.invitation.email}. They&apos;ll set a password and land on the onboarding wizard.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs font-mono bg-white border rounded px-2 py-1">
                    {created.devAcceptUrl}
                  </code>
                  <Button size="sm" variant="outline" onClick={onCopy}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <a
                    href={created.devAcceptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center text-xs text-neutral-600 hover:text-neutral-900"
                  >
                    Open <ExternalLink className="h-3 w-3 ml-0.5" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-500">
            An invite email has been queued for {created.invitation.email}.
          </p>
        )}

        <Button onClick={onDone} className="w-full">
          Back to tenants
        </Button>
      </CardContent>
    </Card>
  );
}
