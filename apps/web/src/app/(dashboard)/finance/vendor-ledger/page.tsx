"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, Clock, AlertCircle } from "lucide-react";
import {
  vendors,
  vendorLedgerEntries,
  getPayablesAgeing,
  type Vendor,
} from "@/data/finance-mock";
import { formatCurrency } from "@/data/mock";

const entryTypeConfig: Record<string, { label: string; className: string }> = {
  invoice: { label: "Invoice", className: "bg-blue-50 text-blue-700 border-blue-200" },
  payment: { label: "Payment", className: "bg-green-50 text-green-700 border-green-200" },
  debit_note: { label: "Debit Note", className: "bg-orange-50 text-orange-700 border-orange-200" },
  credit_note: { label: "Credit Note", className: "bg-amber-50 text-amber-700 border-amber-200" },
  opening_balance: { label: "Opening Bal", className: "bg-gray-50 text-gray-600 border-gray-200" },
};

export default function VendorLedgerPage() {
  const [selectedVendorId, setSelectedVendorId] = useState<string>(vendors[0].id);

  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === selectedVendorId),
    [selectedVendorId]
  );

  const entries = useMemo(
    () => vendorLedgerEntries.filter((e) => e.entityId === selectedVendorId),
    [selectedVendorId]
  );

  const ageingBuckets = useMemo(() => getPayablesAgeing(), []);

  const ageingIcons = [Clock, AlertCircle, AlertCircle, AlertCircle];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Vendor Ledger"
        description="View vendor-wise transaction ledger and outstanding payables"
      />

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Vendor:</span>
        <Select
          value={selectedVendorId}
          onValueChange={(v) => setSelectedVendorId(v ?? vendors[0].id)}
        >
          <SelectTrigger className="w-[320px]">
            <SelectValue placeholder="Select vendor" />
          </SelectTrigger>
          <SelectContent>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedVendor && (
        <Card>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Vendor Name</p>
                <p className="text-sm font-medium mt-0.5">{selectedVendor.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">GSTIN</p>
                <p className="text-sm font-mono mt-0.5">{selectedVendor.gstin}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Outstanding Balance</p>
                <p className="text-sm font-semibold mt-0.5 text-amber-700">
                  {formatCurrency(selectedVendor.outstandingBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">State</p>
                <p className="text-sm font-medium mt-0.5">{selectedVendor.state}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ledger Entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No ledger entries for this vendor
                    </TableCell>
                  </TableRow>
                )}
                {entries.map((entry) => {
                  const typeCfg = entryTypeConfig[entry.type] ?? entryTypeConfig.invoice;
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm">{entry.date}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={typeCfg.className}>
                          {typeCfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-mono">{entry.reference}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                        {entry.description}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {entry.debit > 0 ? formatCurrency(entry.debit) : "-"}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {entry.credit > 0 ? formatCurrency(entry.credit) : "-"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatCurrency(entry.runningBalance)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-semibold mb-3">Payables Ageing</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ageingBuckets.map((bucket, idx) => (
            <KPICard
              key={bucket.label}
              title={`${bucket.label} (${bucket.range})`}
              value={formatCurrency(bucket.amount)}
              change={`${bucket.count} invoice${bucket.count !== 1 ? "s" : ""}`}
              trend="neutral"
              icon={ageingIcons[idx]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
