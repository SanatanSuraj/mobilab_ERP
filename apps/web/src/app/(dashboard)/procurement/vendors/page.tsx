"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  vendors,
  Vendor,
  VendorStatus,
  VendorCategory,
  formatCurrency,
  getRatingColor,
  getRatingLabel,
} from "@/data/procurement-mock";
import { Building2, CheckCircle2, AlertTriangle, Ban, Plus } from "lucide-react";

const CATEGORIES: VendorCategory[] = [
  "PCB Manufacturer",
  "Mechanical",
  "Electronic Components",
  "Reagent Supplier",
  "Packaging",
  "Logistics",
  "Service",
  "Other",
];

export default function VendorsPage() {
  const router = useRouter();

  // Filter state
  const [statusFilter, setStatusFilter] = useState<VendorStatus | "ALL">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<VendorCategory | "ALL">("ALL");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);

  // New vendor form state
  const [newLegalName, setNewLegalName] = useState("");
  const [newTradeName, setNewTradeName] = useState("");
  const [newGstin, setNewGstin] = useState("");
  const [newCategory, setNewCategory] = useState<VendorCategory | "">("");
  const [newPaymentTerms, setNewPaymentTerms] = useState<string>("");
  const [newContactName, setNewContactName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // KPI counts
  const totalVendors = vendors.length;
  const activeCount = useMemo(() => vendors.filter((v) => v.status === "ACTIVE").length, []);
  const probationCount = useMemo(() => vendors.filter((v) => v.status === "ON_PROBATION").length, []);
  const blacklistedCount = useMemo(() => vendors.filter((v) => v.status === "BLACKLISTED").length, []);

  // Filtered vendors
  const filtered = useMemo(() => {
    return vendors.filter((v) => {
      const matchStatus = statusFilter === "ALL" || v.status === statusFilter;
      const matchCategory = categoryFilter === "ALL" || v.category === categoryFilter;
      return matchStatus && matchCategory;
    });
  }, [statusFilter, categoryFilter]);

  const columns: Column<Vendor>[] = [
    {
      key: "code",
      header: "Code",
      render: (v) => (
        <span className="font-mono text-xs text-muted-foreground">{v.code}</span>
      ),
    },
    {
      key: "legalName",
      header: "Vendor Name",
      sortable: true,
      render: (v) => (
        <div>
          <p className="font-semibold text-sm">{v.legalName}</p>
          <p className="text-xs text-muted-foreground">{v.tradeName}</p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (v) => (
        <Badge variant="outline" className="text-xs whitespace-nowrap">
          {v.category}
        </Badge>
      ),
    },
    {
      key: "gstin",
      header: "GSTIN",
      render: (v) => (
        <span className="font-mono text-xs text-muted-foreground">{v.gstin}</span>
      ),
    },
    {
      key: "contactName",
      header: "Contact",
      render: (v) => (
        <div>
          <p className="text-sm">{v.contactName}</p>
          <p className="text-xs text-muted-foreground">{v.phone}</p>
        </div>
      ),
    },
    {
      key: "paymentTerms",
      header: "Payment Terms",
      render: (v) => <span className="text-sm">{v.paymentTerms}</span>,
    },
    {
      key: "leadTimeDays",
      header: "Lead Time",
      render: (v) => <span className="text-sm">{v.leadTimeDays} days</span>,
    },
    {
      key: "ratingScore",
      header: "Rating",
      render: (v) => (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-bold ${getRatingColor(v.ratingScore)}`}>
              {v.ratingScore}
            </span>
            <span className={`text-xs ${getRatingColor(v.ratingScore)}`}>
              {getRatingLabel(v.ratingScore)}
            </span>
          </div>
          <Progress value={v.ratingScore} className="h-1 w-16" />
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (v) => <StatusBadge status={v.status} />,
    },
    {
      key: "totalPOValue",
      header: "Total PO Value",
      className: "text-right",
      render: (v) => (
        <span className="text-sm font-medium text-right block">
          {formatCurrency(v.totalPOValue)}
        </span>
      ),
    },
    {
      key: "msmeRegistered",
      header: "MSME",
      render: (v) =>
        v.msmeRegistered ? (
          <Badge className="bg-green-50 text-green-700 border border-green-200 text-xs font-medium">
            MSME
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
  ];

  function handleReset() {
    setNewLegalName("");
    setNewTradeName("");
    setNewGstin("");
    setNewCategory("");
    setNewPaymentTerms("");
    setNewContactName("");
    setNewPhone("");
    setNewEmail("");
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Vendors"
        description="Approved vendor master with performance ratings"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Vendor
          </Button>
        }
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Total Vendors"
          value={String(totalVendors)}
          icon={Building2}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Active"
          value={String(activeCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="On Probation"
          value={String(probationCount)}
          icon={AlertTriangle}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Blacklisted"
          value={String(blacklistedCount)}
          icon={Ban}
          iconColor="text-red-600"
        />
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-medium">Status:</span>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter((v ?? "ALL") as VendorStatus | "ALL")}
            >
              <SelectTrigger className="w-40 h-8 text-sm">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="ON_PROBATION">On Probation</SelectItem>
                <SelectItem value="BLACKLISTED">Blacklisted</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-medium">Category:</span>
            <Select
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter((v ?? "ALL") as VendorCategory | "ALL")}
            >
              <SelectTrigger className="w-48 h-8 text-sm">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Categories</SelectItem>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="ml-auto text-sm text-muted-foreground">
            {filtered.length} vendor{filtered.length !== 1 ? "s" : ""}
          </span>
        </CardContent>
      </Card>

      {/* DataTable */}
      <DataTable
        data={filtered}
        columns={columns}
        searchKey="legalName"
        searchPlaceholder="Search vendors..."
        onRowClick={(v) => router.push(`/procurement/vendors/${v.id}`)}
        pageSize={10}
      />

      {/* New Vendor Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Legal Name</label>
                <Input
                  placeholder="Full legal entity name"
                  value={newLegalName}
                  onChange={(e) => setNewLegalName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Trade Name</label>
                <Input
                  placeholder="Trading / brand name"
                  value={newTradeName}
                  onChange={(e) => setNewTradeName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">GSTIN</label>
              <Input
                placeholder="15-character GSTIN"
                maxLength={15}
                value={newGstin}
                onChange={(e) => setNewGstin(e.target.value.toUpperCase())}
                className="font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Category</label>
                <Select
                  value={newCategory}
                  onValueChange={(v) => setNewCategory((v ?? "") as VendorCategory | "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Payment Terms</label>
                <Select
                  value={newPaymentTerms}
                  onValueChange={(v) => setNewPaymentTerms(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select terms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Net 15">Net 15</SelectItem>
                    <SelectItem value="Net 30">Net 30</SelectItem>
                    <SelectItem value="Net 45">Net 45</SelectItem>
                    <SelectItem value="Advance">Advance</SelectItem>
                    <SelectItem value="On Delivery">On Delivery</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Contact Name</label>
                <Input
                  placeholder="Primary contact"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Phone</label>
                <Input
                  placeholder="+91-XXXXX-XXXXX"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="vendor@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                handleReset();
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                // Demo: just close dialog
                handleReset();
                setDialogOpen(false);
              }}
            >
              Save Vendor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
