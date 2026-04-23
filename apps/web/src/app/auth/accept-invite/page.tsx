"use client";

/**
 * /auth/accept-invite — consume an invitation token and finish onboarding.
 *
 * Flow:
 *   1. Parse ?token=<64-hex> from the URL.
 *   2. GET /auth/accept-invite/preview → show email + org + role + expiry.
 *      Four outcomes classified server-side:
 *        • PENDING             — happy path, render form
 *        • EXPIRED / REVOKED / ACCEPTED — render terminal state message
 *      The error map here mirrors the ApiProblem codes the API returns.
 *   3. User submits:
 *        - new identity  → name + password (min 12)
 *        - existing identity → name only; the invitee signs in with their
 *          existing password on the dashboard side, because server won't
 *          accept a password field when identityExists=true
 *   4. POST /auth/accept-invite → access+refresh tokens → stash them the
 *      exact same way /auth/login does (sessionStorage + session cookie +
 *      mock store hydration) and push to `/`.
 *
 * Next.js 16 requires client components that call useSearchParams() to be
 * wrapped in <Suspense> during prerender — mirror the structure in
 * /auth/login (inner <AcceptInviteForm> + outer Suspense boundary).
 */

import { Suspense, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FlaskConical,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Mail,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

import {
  apiAcceptInvite,
  apiPreviewAcceptInvite,
} from "@/lib/api/admin-users";
import { ApiProblem, setTenantTokens } from "@/lib/api/tenant-fetch";
import {
  useAuthStore,
  MOCK_USERS_BY_ROLE,
  type UserRole,
} from "@/store/auth.store";
import type {
  AcceptInvitePreviewResponse,
  AcceptInviteResponse,
  Role,
} from "@instigenie/contracts";

// Mirrors /auth/login — any tenant-flow entry point that hydrates the app
// needs to write the optimistic session cookie that proxy.ts checks.
const SESSION_COOKIE = "instigenie-session";

// Same priority list as /auth/login — keep the mock role store filled
// until every page reads /auth/me directly.
const ROLE_PRIORITY: UserRole[] = [
  "SUPER_ADMIN",
  "MANAGEMENT",
  "FINANCE",
  "SALES_MANAGER",
  "SALES_REP",
  "PRODUCTION_MANAGER",
  "PRODUCTION",
  "QC_MANAGER",
  "QC_INSPECTOR",
  "RD",
  "STORES",
  "CUSTOMER",
];

function pickPrimaryRole(roles: readonly string[]): UserRole | null {
  for (const candidate of ROLE_PRIORITY) {
    if (roles.includes(candidate)) return candidate;
  }
  return null;
}

const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  MANAGEMENT: "Management",
  SALES_REP: "Sales Rep",
  SALES_MANAGER: "Sales Manager",
  FINANCE: "Finance",
  PRODUCTION: "Production Operator",
  PRODUCTION_MANAGER: "Production Manager",
  RD: "R&D / Engineering",
  QC_INSPECTOR: "QC Inspector",
  QC_MANAGER: "QC Manager",
  STORES: "Stores",
  CUSTOMER: "Customer Portal",
};

export default function AcceptInvitePage(): React.JSX.Element {
  return (
    <Suspense fallback={<AcceptInviteFallback />}>
      <AcceptInviteForm />
    </Suspense>
  );
}

function AcceptInviteFallback(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

type PreviewState =
  | { kind: "loading" }
  | { kind: "ready"; preview: AcceptInvitePreviewResponse }
  | { kind: "error"; title: string; detail: string };

function AcceptInviteForm(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const setRole = useAuthStore((s) => s.setRole);
  const fetchPermissions = useAuthStore((s) => s.fetchPermissions);

  // Initial state derives the missing-token case synchronously so we never
  // need to setState inside the effect for that branch — React 19's
  // set-state-in-effect rule flags synchronous setState in effects.
  const [preview, setPreview] = useState<PreviewState>(() =>
    token
      ? { kind: "loading" }
      : {
          kind: "error",
          title: "Missing token",
          detail:
            "This invitation link is incomplete. Ask the person who invited you to resend it.",
        },
  );
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isPending, startTransition] = useTransition();

  // Run preview once per token change. All setState calls happen after the
  // await so React 19's set-state-in-effect rule passes.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiPreviewAcceptInvite(token);
        if (cancelled) return;
        setPreview({ kind: "ready", preview: res });
        // Pre-fill name from the inviter's hint if they supplied one.
        if (res.suggestedName) setName(res.suggestedName);
      } catch (err) {
        if (cancelled) return;
        setPreview(errorStateFor(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function completeAuth(res: AcceptInviteResponse): void {
    setTenantTokens(res.accessToken, res.refreshToken);

    const primaryRole = pickPrimaryRole(res.user.roles);
    if (primaryRole) {
      setRole(primaryRole);
      // Overwrite mock identity with the real invitee details so the top bar
      // chip, sidebar avatar, etc. match who's actually signed in. Mirrors
      // /auth/login's completeAuth(). Do NOT overwrite orgId — see the same
      // comment in /auth/login for why.
      useAuthStore.setState({
        user: {
          id: res.user.id,
          name: res.user.name || res.user.email,
          email: res.user.email,
          avatar:
            MOCK_USERS_BY_ROLE[primaryRole].avatar ||
            res.user.email.slice(0, 2).toUpperCase(),
        },
      });
      void fetchPermissions();
    }

    // proxy.ts gate cookie. Not httpOnly by design — this is a presence
    // flag; the real credential is the JWT in sessionStorage. See /auth/login
    // for the production-migration note.
    document.cookie = `${SESSION_COOKIE}=1; path=/; SameSite=Lax`;

    router.push("/");
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (preview.kind !== "ready") return;
    setSubmitError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmitError("Please enter your name.");
      return;
    }
    if (!preview.preview.identityExists) {
      if (password.length < 12) {
        setSubmitError("Password must be at least 12 characters.");
        return;
      }
    }

    const body = {
      token,
      name: trimmedName,
      // Only ship password on the new-identity branch. The API rejects it
      // with a 400 when identityExists=true.
      ...(preview.preview.identityExists ? {} : { password }),
    };
    startTransition(async () => {
      try {
        const res = await apiAcceptInvite(body);
        completeAuth(res);
      } catch (err) {
        if (err instanceof ApiProblem) {
          setSubmitError(err.problem.detail ?? err.problem.title);
        } else {
          setSubmitError("Could not reach the API. Is it running on :4000?");
        }
      }
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  if (preview.kind === "loading") {
    return <AcceptInviteFallback />;
  }

  if (preview.kind === "error") {
    return (
      <ErrorShell title={preview.title} detail={preview.detail} />
    );
  }

  const { preview: p } = preview;

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <FlaskConical className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Join {p.orgName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Finish setting up your Instigenie account.
            </p>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardContent className="pt-6 space-y-4">
            <div className="rounded-md bg-muted/60 border px-3 py-2 text-xs space-y-0.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Mail className="h-3 w-3" />
                <span>Invited as</span>
              </div>
              <p className="text-sm font-medium break-all">{p.email}</p>
              <p className="text-[11px] text-muted-foreground">
                Role: {ROLE_LABELS[p.roleId]} · Expires{" "}
                {new Date(p.expiresAt).toLocaleString()}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="accept-name">Your name</Label>
                <Input
                  id="accept-name"
                  autoComplete="name"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={isPending}
                />
              </div>

              {p.identityExists ? (
                <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
                  This email already has an Instigenie account. Accepting will
                  add <span className="font-medium">{p.orgName}</span> to your
                  workspaces — sign in with your existing password after.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="accept-password">Set a password</Label>
                  <div className="relative">
                    <Input
                      id="accept-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="At least 12 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={12}
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
                  <p className="text-[11px] text-muted-foreground">
                    12+ characters. You&apos;ll use this to sign in next time.
                  </p>
                </div>
              )}

              {submitError && (
                <p className="text-xs text-destructive leading-snug">
                  {submitError}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Finishing…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Accept invite
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Instigenie ERP · /auth/accept-invite
        </p>
      </div>
    </div>
  );
}

function ErrorShell({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{detail}</p>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardContent className="pt-6 space-y-2">
            <a href="/auth/login" className="block">
              <Button variant="outline" className="w-full">
                Go to sign-in
              </Button>
            </a>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Instigenie ERP · /auth/accept-invite
        </p>
      </div>
    </div>
  );
}

/**
 * Translate an ApiProblem from /auth/accept-invite/preview into one of the
 * terminal-state screens.
 *
 * The API's @instigenie/errors catalogue uses generic HTTP-family codes
 * (`not_found`, `forbidden`, `conflict`, `validation_error`) rather than
 * per-feature codes, so we inspect the `detail` message thrown by
 * admin-users/service.ts to choose the right copy. Falls through to the
 * raw detail for anything unexpected so ops can still diagnose in browser.
 */
function errorStateFor(err: unknown): PreviewState {
  if (!(err instanceof ApiProblem)) {
    return {
      kind: "error",
      title: "Couldn't load invitation",
      detail: "Could not reach the API. Is it running on :4000?",
    };
  }
  const { code, detail } = err.problem;
  const msg = (detail ?? "").toLowerCase();
  if (code === "not_found" || code === "validation_error") {
    return {
      kind: "error",
      title: "Invitation not found",
      detail:
        "The link looks invalid or has been superseded. Ask the sender to resend it.",
    };
  }
  if (code === "forbidden" && msg.includes("expired")) {
    return {
      kind: "error",
      title: "Invitation expired",
      detail:
        "This invitation has expired. Ask the sender to issue a fresh one.",
    };
  }
  if (code === "forbidden" && msg.includes("revoked")) {
    return {
      kind: "error",
      title: "Invitation revoked",
      detail:
        "An admin revoked this invitation. Contact them for a new link.",
    };
  }
  if (code === "conflict" && msg.includes("accepted")) {
    return {
      kind: "error",
      title: "Already accepted",
      detail:
        "This invitation was already used. Sign in with your existing credentials.",
    };
  }
  return {
    kind: "error",
    title: err.problem.title || "Couldn't load invitation",
    detail: err.problem.detail ?? "Please ask the sender to resend the link.",
  };
}
