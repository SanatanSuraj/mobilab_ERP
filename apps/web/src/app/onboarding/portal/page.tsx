"use client";

/**
 * /onboarding/portal — Phase 4b of the guided post-invite setup.
 *
 * "Portal user" in this codebase = a user whose role is CUSTOMER and
 * whose JWT audience is the portal surface. Creation re-uses the
 * existing invite system (`POST /admin/users/invite` with
 * `roleId: "CUSTOMER"`), so this page is a thin specialised UI on
 * top of admin-users — no new backend.
 *
 * What the customer can do once they accept the invite is bounded by
 * the CUSTOMER role's permission set: view their own invoices, file
 * support tickets. They can NOT see other tenants, other customers'
 * orders, or any internal app surface.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Copy,
  Check,
  ShieldCheck,
  ReceiptText,
  LifeBuoy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  apiInviteUser,
  apiListInvitations,
} from "@/lib/api/admin-users";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import type {
  InvitationSummary,
  InviteUserResponse,
} from "@instigenie/contracts";

const NEXT_HREF = "/onboarding/done";
const BACK_HREF = "/onboarding/team";

export default function OnboardingPortalPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<InviteUserResponse | null>(null);
  const [pending, setPending] = useState<InvitationSummary[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiListInvitations({ status: "PENDING", limit: 25 })
      .then((r) => {
        if (cancelled) return;
        // Only show portal invites here.
        setPending(
          r.items.filter((i: InvitationSummary) => i.roleId === "CUSTOMER"),
        );
        setLoadingPending(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiProblem && err.problem.status === 401) {
          router.replace(`/auth/login?from=${encodeURIComponent("/onboarding/portal")}`);
          return;
        }
        if (err instanceof ApiProblem && err.problem.status === 403) {
          router.replace("/dashboard");
          return;
        }
        setLoadingPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, router]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setLastInvite(null);
    try {
      const r = await apiInviteUser({
        email: email.trim(),
        roleId: "CUSTOMER",
        name: name.trim() || undefined,
      });
      setLastInvite(r);
      setEmail("");
      setName("");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      if (err instanceof ApiProblem) {
        setError(err.problem.detail ?? err.problem.title ?? "Invite failed");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function copyDevUrl() {
    if (!lastInvite?.devAcceptUrl) return;
    try {
      await navigator.clipboard.writeText(lastInvite.devAcceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">
            Set up the customer portal
          </h1>
          <p className="text-sm text-neutral-500">
            Invite a customer to a self-serve portal where they can view their invoices and
            file support tickets — no internal access.
          </p>
        </div>

        {/* What the portal allows */}
        <Card className="mb-6 bg-neutral-900 text-white border-neutral-900">
          <CardContent className="pt-6">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="flex items-start gap-2">
                <ReceiptText className="h-5 w-5 mt-0.5" />
                <div>
                  <div className="font-medium">View invoices</div>
                  <div className="text-neutral-400 text-xs">Their own bills only.</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <LifeBuoy className="h-5 w-5 mt-0.5" />
                <div>
                  <div className="font-medium">File tickets</div>
                  <div className="text-neutral-400 text-xs">Support without email.</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-5 w-5 mt-0.5" />
                <div>
                  <div className="font-medium">Tenant-isolated</div>
                  <div className="text-neutral-400 text-xs">Cannot see other customers.</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Invite form */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-base font-medium">Invite a customer</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSend} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cust-email">Customer email</Label>
                  <Input
                    id="cust-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@acme.com"
                    required
                    maxLength={254}
                  />
                </div>
                <div>
                  <Label htmlFor="cust-name">Name (optional)</Label>
                  <Input
                    id="cust-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Their full name"
                    maxLength={120}
                  />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send portal invite"}
              </Button>
            </form>

            {lastInvite?.devAcceptUrl && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Dev portal link (non-production only)</p>
                    <p className="text-xs text-neutral-600 mt-0.5 mb-2">
                      Copy this and send it to the customer. In production they get an email.
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate text-xs font-mono bg-white border rounded px-2 py-1">
                        {lastInvite.devAcceptUrl}
                      </code>
                      <Button size="sm" variant="outline" onClick={copyDevUrl}>
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending portal invites */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-base font-medium">Pending portal invites</h2>
          </CardHeader>
          <CardContent>
            {loadingPending ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
              </div>
            ) : pending.length === 0 ? (
              <p className="text-sm text-neutral-500 italic">No pending portal invites yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {pending.map((inv) => (
                  <li key={inv.id} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{inv.email}</div>
                      <div className="text-xs text-neutral-500">
                        Expires {new Date(inv.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant="outline">Customer</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => router.push(BACK_HREF)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => router.push(NEXT_HREF)}>
              Skip for now
            </Button>
            <Button onClick={() => router.push(NEXT_HREF)}>
              Continue <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
