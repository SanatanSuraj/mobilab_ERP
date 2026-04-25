"use client";

/**
 * Customer portal — landing page. Reads /portal/me to show the
 * logged-in customer's name and three live counts (open orders,
 * unpaid invoices, open tickets). The shortcut tiles route to the
 * read-only and read+write surfaces under /portal/*.
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiPortalSummary } from "@/hooks/usePortalApi";
import {
  AlertCircle,
  ArrowRight,
  FileText,
  ShoppingCart,
  Ticket,
} from "lucide-react";

interface PortalLink {
  title: string;
  description: string;
  href: string;
  icon: typeof ShoppingCart;
  iconColor: string;
  countKey: "openOrders" | "unpaidInvoices" | "openTickets";
  countLabel: string;
}

const portalLinks: PortalLink[] = [
  {
    title: "Order History",
    description: "Past and current orders",
    href: "/portal/orders",
    icon: ShoppingCart,
    iconColor: "text-blue-600 bg-blue-50",
    countKey: "openOrders",
    countLabel: "open",
  },
  {
    title: "Invoices",
    description: "Posted invoices and payment status",
    href: "/portal/invoices",
    icon: FileText,
    iconColor: "text-emerald-600 bg-emerald-50",
    countKey: "unpaidInvoices",
    countLabel: "unpaid",
  },
  {
    title: "Support Tickets",
    description: "Open new tickets and track requests",
    href: "/portal/tickets",
    icon: Ticket,
    iconColor: "text-purple-600 bg-purple-50",
    countKey: "openTickets",
    countLabel: "open",
  },
];

export default function PortalPage() {
  const summaryQuery = useApiPortalSummary();

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customer Portal</h1>
        {summaryQuery.isLoading ? (
          <Skeleton className="h-4 w-48 mt-2" />
        ) : summaryQuery.isError ? (
          <p className="text-sm text-red-700 mt-1">
            Couldn&apos;t load portal session.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">
            Welcome, {summaryQuery.data?.customer.name ?? "Customer"}.
          </p>
        )}
      </div>

      {summaryQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load summary</p>
            <p className="text-red-700 mt-1">
              {summaryQuery.error instanceof Error
                ? summaryQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {portalLinks.map((link) => {
            const count = summaryQuery.data?.counts[link.countKey];
            return (
              <Link key={link.title} href={link.href}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className={`p-2.5 rounded-lg ${link.iconColor}`}
                      >
                        <link.icon className="h-5 w-5" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-4 space-y-0.5">
                      <p className="text-sm font-medium">{link.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {link.description}
                      </p>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      {summaryQuery.isLoading ? (
                        <Skeleton className="h-4 w-20" />
                      ) : (
                        <>
                          <span className="font-semibold text-foreground">
                            {(count ?? 0).toLocaleString()}
                          </span>{" "}
                          {link.countLabel}
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
