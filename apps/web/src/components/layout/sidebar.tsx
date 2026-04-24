"use client";

import React, { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  FlaskConical,
  Users,
  ShoppingCart,
  Factory,
  IndianRupee,
  Settings,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore, UserRole } from "@/store/auth.store";

// Roles that see everything (no filtering needed)
const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "MANAGEMENT"];

type NavChild = { label: string; href: string };
type NavItem = {
  label: string;
  href: string;
  roles?: UserRole[]; // undefined = all roles
  children?: NavChild[];
};
type NavSection = {
  section: string;
  icon: React.ElementType;
  roles?: UserRole[]; // undefined = all roles (section-level gate)
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    section: "Lead to Cash",
    icon: Users,
    roles: ["SUPER_ADMIN", "MANAGEMENT", "SALES_REP", "SALES_MANAGER", "FINANCE", "CUSTOMER"],
    items: [
      {
        label: "Leads & Pipeline",
        href: "/crm/leads",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "SALES_REP", "SALES_MANAGER"],
        children: [
          { label: "Pipeline", href: "/crm/pipeline" },
          { label: "Leads", href: "/crm/leads" },
          { label: "Accounts", href: "/crm/accounts" },
          { label: "Contacts", href: "/crm/contacts" },
        ],
      },
      {
        label: "Deals & Quotations",
        href: "/crm/deals",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "SALES_REP", "SALES_MANAGER", "FINANCE"],
        children: [
          { label: "Deals", href: "/crm/deals" },
          { label: "Quotations", href: "/crm/quotations" },
        ],
      },
      {
        label: "Orders & Dispatch",
        href: "/crm/orders",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "SALES_REP", "SALES_MANAGER", "FINANCE"],
      },
      { label: "Support Tickets", href: "/crm/tickets" }, // all roles
    ],
  },
  {
    section: "Procure to Stock",
    icon: ShoppingCart,
    roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION", "PRODUCTION_MANAGER", "RD", "STORES", "FINANCE", "QC_INSPECTOR", "QC_MANAGER"],
    items: [
      {
        label: "Vendors",
        href: "/procurement/vendors",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION_MANAGER", "FINANCE"],
      },
      {
        label: "Indents & POs",
        href: "/procurement/indents",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION", "PRODUCTION_MANAGER", "STORES", "FINANCE"],
        children: [
          { label: "Indents", href: "/procurement/indents" },
          { label: "Purchase Orders", href: "/procurement/purchase-orders" },
          { label: "Approvals", href: "/procurement/approvals" },
        ],
      },
      {
        label: "Inward & Gate Entry",
        href: "/procurement/inward",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "STORES", "PRODUCTION_MANAGER"],
      },
      {
        label: "GRN & QC",
        href: "/procurement/grn-qc",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "STORES", "QC_INSPECTOR", "QC_MANAGER", "PRODUCTION_MANAGER"],
      },
      {
        label: "Stock",
        href: "/inventory/stock",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION", "PRODUCTION_MANAGER", "RD", "STORES", "FINANCE", "QC_INSPECTOR", "QC_MANAGER"],
        children: [
          { label: "Stock Overview", href: "/inventory/stock" },
          { label: "Item Master", href: "/inventory/items" },
          { label: "Serial Numbers", href: "/inventory/serials" },
          { label: "Batches", href: "/inventory/batches" },
        ],
      },
      {
        label: "Transfers & Adjustments",
        href: "/inventory/transfers",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "STORES", "PRODUCTION_MANAGER"],
        children: [
          { label: "Transfers", href: "/inventory/transfers" },
          { label: "Adjustments", href: "/inventory/adjustments" },
          { label: "Returns", href: "/procurement/returns" },
        ],
      },
      {
        label: "Reorder Alerts",
        href: "/inventory/reorder",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "STORES", "PRODUCTION_MANAGER", "FINANCE"],
      },
    ],
  },
  {
    section: "Plan to Produce",
    icon: Factory,
    roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION", "PRODUCTION_MANAGER", "RD", "QC_INSPECTOR", "QC_MANAGER"],
    items: [
      {
        label: "Products",
        href: "/production/products",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION_MANAGER", "RD", "PRODUCTION", "QC_MANAGER"],
      },
      {
        label: "Work Orders",
        href: "/production/work-orders",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION", "PRODUCTION_MANAGER", "RD"],
      },
      {
        label: "Shop Floor / WIP",
        href: "/production/shop-floor",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION", "PRODUCTION_MANAGER"],
        children: [
          { label: "Shop Floor", href: "/production/shop-floor" },
          { label: "WIP Tracking", href: "/production/wip" },
        ],
      },
      {
        label: "BOM & ECN",
        href: "/production/bom",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION_MANAGER", "RD"],
        children: [
          { label: "BOM", href: "/production/bom" },
          { label: "ECN", href: "/production/ecn" },
          { label: "MRP", href: "/production/mrp" },
        ],
      },
      {
        label: "QC Inspections",
        href: "/qc/dashboard",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "QC_INSPECTOR", "QC_MANAGER", "PRODUCTION_MANAGER"],
        children: [
          { label: "Dashboard", href: "/qc/dashboard" },
          { label: "Incoming QC", href: "/qc/inward" },
          { label: "WIP Inspection", href: "/qc/wip" },
          { label: "Final QC", href: "/qc/final" },
          { label: "CAPA", href: "/qc/capa" },
          { label: "NCR", href: "/qc/ncr" },
          { label: "Equipment", href: "/qc/equipment" },
        ],
      },
      {
        label: "Device & Module IDs",
        href: "/production/device-ids",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION_MANAGER", "QC_MANAGER", "RD"],
        children: [
          { label: "Device & Module IDs", href: "/production/device-ids" },
          { label: "BMR", href: "/production/bmr" },
          { label: "Scrap & CAPA", href: "/production/scrap" },
          { label: "OEE & COPQ", href: "/production/oee" },
        ],
      },
      {
        label: "Reports",
        href: "/production/reports",
        roles: ["SUPER_ADMIN", "MANAGEMENT", "PRODUCTION_MANAGER"],
      },
    ],
  },
  {
    section: "Finance & Compliance",
    icon: IndianRupee,
    roles: ["SUPER_ADMIN", "MANAGEMENT", "FINANCE"],
    items: [
      { label: "Sales Invoices", href: "/finance/sales-invoices" },
      { label: "Purchase Invoices", href: "/finance/purchase-invoices" },
      { label: "Customer Ledger", href: "/finance/customer-ledger" },
      { label: "Vendor Ledger", href: "/finance/vendor-ledger" },
      { label: "E-Way Bills", href: "/finance/eway-bills" },
      { label: "GST Reports", href: "/finance/gst-reports" },
    ],
  },
  {
    section: "Admin",
    icon: Settings,
    roles: ["SUPER_ADMIN"],
    items: [
      { label: "Item Master", href: "/inventory/items" },
      { label: "Products", href: "/admin/products" },
      { label: "Warehouses", href: "/inventory/warehouses" },
      { label: "Users & Roles", href: "/admin/users" },
    ],
  },
];

const ALL_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "MANAGEMENT",
  "SALES_REP",
  "SALES_MANAGER",
  "FINANCE",
  "PRODUCTION",
  "PRODUCTION_MANAGER",
  "RD",
  "QC_INSPECTOR",
  "QC_MANAGER",
  "STORES",
  "CUSTOMER",
];

export const Sidebar = React.memo(function Sidebar() {
  const pathname = usePathname();
  // Selective Zustand subscriptions — only the fields used
  const role = useAuthStore((s) => s.role);
  const setRole = useAuthStore((s) => s.setRole);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  function toggleItem(label: string) {
    setExpandedItems((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  }

  // Memoized isActive — only recomputes when pathname changes
  const isActive = useCallback(
    (href: string) => {
      if (href === "/") return pathname === "/";
      return pathname.startsWith(href);
    },
    [pathname]
  );

  // Memoized visible sections + items — only recomputes when role changes
  const visibleSections = useMemo(() => {
    if (!role) return [];
    const isAdmin = ADMIN_ROLES.includes(role);
    return navSections
      .filter((s) => isAdmin || !s.roles || s.roles.includes(role))
      .map((s) => ({
        ...s,
        items: isAdmin
          ? s.items
          : s.items.filter((item) => !item.roles || item.roles.includes(role)),
      }))
      .filter((s) => s.items.length > 0); // drop sections that become empty
  }, [role]);

  return (
    <aside
      className={cn(
        "h-screen border-r bg-background flex flex-col transition-all duration-200",
        collapsed ? "w-[60px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className="h-14 border-b flex items-center px-4 gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
          <FlaskConical className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <span className="font-bold text-base tracking-tight">Instigenie ERP</span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {/* Dashboard */}
        <div className="mb-1">
          <Link
            href="/"
            className={cn(
              "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
              isActive("/") && pathname === "/"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Dashboard</span>}
          </Link>
        </div>

        {visibleSections.map((section) => {
          const SectionIcon = section.icon;
          return (
            <div key={section.section} className="mt-3">
              {!collapsed && (
                <div className="flex items-center gap-1.5 px-2.5 mb-1">
                  <SectionIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {section.section}
                  </span>
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const hasChildren = item.children && item.children.length > 0;
                  const expanded = expandedItems.includes(item.label);
                  const active = isActive(item.href);

                  return (
                    <div key={item.label}>
                      {hasChildren ? (
                        <>
                          <button
                            onClick={() => toggleItem(item.label)}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
                              active
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                          >
                            {collapsed ? (
                              <span className="h-4 w-4 shrink-0 text-[10px] font-bold">
                                {item.label.charAt(0)}
                              </span>
                            ) : (
                              <>
                                <span className="flex-1 text-left">{item.label}</span>
                                <ChevronRight
                                  className={cn(
                                    "h-3.5 w-3.5 transition-transform",
                                    expanded && "rotate-90"
                                  )}
                                />
                              </>
                            )}
                          </button>
                          {expanded && !collapsed && (
                            <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-3">
                              {item.children!.map((child) => (
                                <Link
                                  key={child.href}
                                  href={child.href}
                                  className={cn(
                                    "block px-2.5 py-1.5 rounded-md text-sm transition-colors",
                                    pathname === child.href ||
                                      pathname.startsWith(child.href + "/")
                                      ? "text-primary font-medium bg-primary/5"
                                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                  )}
                                >
                                  {child.label}
                                </Link>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <Link
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
                            active
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          {collapsed ? (
                            <span className="h-4 w-4 shrink-0 text-[10px] font-bold">
                              {item.label.charAt(0)}
                            </span>
                          ) : (
                            <span>{item.label}</span>
                          )}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Dev Role Switcher */}
      {process.env.NODE_ENV === "development" && !collapsed && (
        <div className="border-t px-3 py-2 shrink-0">
          <label className="block text-[10px] font-semibold text-muted-foreground mb-1">
            🛠 Dev: Switch Role
          </label>
          <select
            value={role ?? ""}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="w-full text-xs rounded border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Collapse Toggle */}
      <div className="border-t p-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
});
