"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ShoppingCart, FileText, Ticket, Clock } from "lucide-react";

const portalLinks = [
  {
    title: "Orders History",
    description: "View your past and current orders",
    href: "/portal/orders",
    icon: ShoppingCart,
    iconColor: "text-blue-600 bg-blue-50",
  },
  {
    title: "Invoices",
    description: "View and download your invoices",
    href: "/portal/orders",
    icon: FileText,
    iconColor: "text-green-600 bg-green-50",
  },
  {
    title: "Support Tickets",
    description: "Track your support requests",
    href: "/portal/tickets",
    icon: Ticket,
    iconColor: "text-purple-600 bg-purple-50",
  },
];

const recentActivity = [
  { text: "Order ORD-2026-002 delivered successfully", time: "2 days ago", icon: ShoppingCart },
  { text: "Invoice INV-2026-001 payment confirmed", time: "1 week ago", icon: FileText },
  { text: "Ticket TK-2026-005 resolved - Firmware update", time: "1 week ago", icon: Ticket },
  { text: "Order ORD-2026-003 confirmed", time: "2 weeks ago", icon: ShoppingCart },
];

export default function PortalPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customer Portal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Welcome, Dr. Rakesh Gupta
        </p>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {portalLinks.map((link) => (
          <Link key={link.title} href={link.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`p-2.5 rounded-lg ${link.iconColor}`}>
                    <link.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{link.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {link.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Recent Activity</h2>
          </div>
          <div className="space-y-3">
            {recentActivity.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{item.text}</p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {item.time}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
