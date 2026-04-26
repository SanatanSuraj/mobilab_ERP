"use client";

/**
 * /onboarding/team — Phase 4a of the guided post-invite setup.
 *
 * Reuses the existing invite system (`POST /admin/users/invite`) — no
 * new backend. The wizard's job is to make this discoverable: most
 * admins forget to invite their team until something breaks.
 *
 * UX: pick a role, type one or more emails, send. Each invite returns
 * a `devAcceptUrl` in non-production so we can show the link inline
 * for the admin to copy/paste during local testing — in production
 * the email goes out and the URL field is undefined.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ArrowRight,
  ArrowLeft,
  UserPlus,
  AlertCircle,
  Copy,
  Check,
  X,
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
  Role,
} from "@instigenie/contracts";

const NEXT_HREF = "/onboarding/portal";
const BACK_HREF = "/onboarding/first-flow";

/** Role suggestions tailored to the wizard. CUSTOMER has its own page. */
const SUGGESTED_ROLES: Array<{ role: Role; label: string; blurb: string }> = [
  { role: "SALES_REP", label: "Sales", blurb: "Create leads, deals, quotations, sales orders." },
  { role: "FINANCE", label: "Finance", blurb: "Invoices, payments, ledger." },
  { role: "PRODUCTION_MANAGER", label: "Production", blurb: "Work orders, BOMs, WIP." },
];

export default function OnboardingTeamPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("SALES_REP");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<InviteUserResponse | null>(null);
  const [pending, setPending] = useState<InvitationSummary[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);

  // Load pending internal invites (filter out CUSTOMER — those belong on /portal page).
  useEffect(() => {
    let cancelled = false;
    void apiListInvitations({ status: "PENDING", limit: 25 })
      .then((r) => {
        if (cancelled) return;
        setPending(
          r.items.filter((i: InvitationSummary) => i.roleId !== "CUSTOMER"),
        );
        setLoadingPending(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiProblem && err.problem.status === 401) {
          router.replace(`/auth/login?from=${encodeURIComponent("/onboarding/team")}`);
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
        roleId: role,
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
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Invite your team</h1>
          <p className="text-sm text-neutral-500">
            Sales, Finance, and Production work better with the right people in each role.
            You can always invite more later from Admin → Users.
          </p>
        </div>

        {/* Invite form */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-base font-medium flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Send an invite
            </h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSend} className="space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wide text-neutral-500">Role</Label>
                <div className="grid grid-cols-3 gap-2 mt-1.5">
                  {SUGGESTED_ROLES.map((r) => (
                    <button
                      key={r.role}
                      type="button"
                      onClick={() => setRole(r.role)}
                      aria-pressed={role === r.role}
                      className={`text-left rounded-lg border p-2.5 transition-colors ${
                        role === r.role
                          ? "border-neutral-900 bg-neutral-50"
                          : "border-neutral-200 bg-white hover:border-neutral-300"
                      }`}
                    >
                      <div className="font-medium text-sm">{r.label}</div>
                      <div className="text-[11px] text-neutral-500 mt-0.5 leading-snug">{r.blurb}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    required
                    maxLength={254}
                  />
                </div>
                <div>
                  <Label htmlFor="name">Name (optional)</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Their full name"
                    maxLength={120}
                  />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invite"}
              </Button>
            </form>

            {/* Dev accept URL surfaced for non-prod */}
            {lastInvite?.devAcceptUrl && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Dev accept link (non-production only)</p>
                    <p className="text-xs text-neutral-600 mt-0.5 mb-2">
                      Email isn&apos;t wired in dev. Copy this and send it to the invitee yourself.
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

        {/* Pending invites */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-base font-medium">Pending invites</h2>
          </CardHeader>
          <CardContent>
            {loadingPending ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
              </div>
            ) : pending.length === 0 ? (
              <p className="text-sm text-neutral-500 italic">No pending invites yet.</p>
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
                    <Badge variant="outline">{inv.roleId}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Footer nav */}
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

        <p className="text-xs text-neutral-400 mt-6 text-center flex items-center justify-center gap-1">
          You can always come back to this page later via Admin → Users.
          <X className="h-3 w-3 hidden" />
        </p>
      </div>
    </div>
  );
}
