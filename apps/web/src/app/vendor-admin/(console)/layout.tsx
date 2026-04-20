"use client";

/**
 * Layout for the authed vendor-admin console.
 *
 * The route group `(console)` is invisible in the URL; everything inside it
 * mounts at `/vendor-admin/*` but shares this layout's guard + chrome. The
 * sibling `/vendor-admin/login` intentionally lives OUTSIDE this group so it
 * renders standalone (no nav, no guard).
 *
 * Guard behaviour:
 *   - On mount we call hydrate() which hits GET /vendor-admin/auth/me.
 *   - While the request is in flight we show a splash ("unknown" state).
 *   - On success: render nav + children.
 *   - On failure: router.replace("/vendor-admin/login?from=…") so the user
 *     lands back here after signing in.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  ClipboardList,
  Loader2,
  LogOut,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useVendorAuthStore } from "@/store/vendor-auth.store";

export default function VendorConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const status = useVendorAuthStore((s) => s.status);
  const admin = useVendorAuthStore((s) => s.admin);
  const hydrate = useVendorAuthStore((s) => s.hydrate);
  const logout = useVendorAuthStore((s) => s.logout);

  // Kick off identity hydration once per mount. Zustand selectors ensure
  // this effect doesn't re-run when status changes.
  useEffect(() => {
    if (status === "unknown") {
      void hydrate();
    }
  }, [status, hydrate]);

  // Redirect signed-out users to /login, preserving where they were headed.
  useEffect(() => {
    if (status === "signed-out") {
      const from = encodeURIComponent(pathname ?? "/vendor-admin/tenants");
      router.replace(`/vendor-admin/login?from=${from}`);
    }
  }, [status, pathname, router]);

  if (status !== "signed-in" || !admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  async function handleLogout() {
    await logout();
    router.replace("/vendor-admin/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-6">
          <Link
            href="/vendor-admin/tenants"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4 text-slate-950" />
            </span>
            Vendor Console
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink
              href="/vendor-admin/tenants"
              active={pathname.startsWith("/vendor-admin/tenants")}
              icon={<Building2 className="h-4 w-4" />}
            >
              Tenants
            </NavLink>
            <NavLink
              href="/vendor-admin/audit"
              active={pathname.startsWith("/vendor-admin/audit")}
              icon={<ClipboardList className="h-4 w-4" />}
            >
              Audit log
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="text-right leading-tight">
              <div className="font-medium">{admin.name}</div>
              <div className="text-xs text-slate-500">{admin.email}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-slate-600 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4 mr-1.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-6 py-6">{children}</div>
      </main>
    </div>
  );
}

function NavLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}
