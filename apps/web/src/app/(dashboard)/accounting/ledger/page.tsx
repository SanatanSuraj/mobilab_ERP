"use client";

// TODO(phase-5): /accounting/ledger uses the legacy prototype ledger model.
// The real journal data lives in the Finance backend (posted sales invoices
// and vendor bills feed the general ledger). The backend does not yet expose a
// GET /finance/ledger-entries list route — it currently serves per-party views
// via useApiCustomerLedger / useApiVendorLedger. Expected route once added:
//   GET /finance/ledger-entries?from=&to=&account=
// Mock import left in place until either the backend ships the list route or
// this page is removed in favour of the per-party ledger pages.

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { ledgerEntries, formatCurrency, formatDate } from "@/data/mock";
import { BookOpen } from "lucide-react";

export default function LedgerPage() {
  const totalDebits = ledgerEntries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredits = ledgerEntries.reduce((sum, e) => sum + e.credit, 0);
  const netBalance = totalDebits - totalCredits;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="General Ledger"
        description="Immutable record of all accounting transactions"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Total Debits
            </p>
            <p className="text-xl font-bold tabular-nums mt-1 text-foreground">
              {formatCurrency(totalDebits)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Total Credits
            </p>
            <p className="text-xl font-bold tabular-nums mt-1 text-foreground">
              {formatCurrency(totalCredits)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Net Balance
            </p>
            <p className="text-xl font-bold tabular-nums mt-1 text-foreground">
              {formatCurrency(netBalance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Ledger Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="border-b bg-muted/30 px-5 py-3 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Transaction Ledger</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-[100px] font-semibold text-xs uppercase tracking-wide">
                  Date
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wide">
                  Account
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wide">
                  Description
                </TableHead>
                <TableHead className="text-right font-semibold text-xs uppercase tracking-wide">
                  Debit
                </TableHead>
                <TableHead className="text-right font-semibold text-xs uppercase tracking-wide">
                  Credit
                </TableHead>
                <TableHead className="text-right font-semibold text-xs uppercase tracking-wide">
                  Balance
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wide">
                  Reference
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerEntries.map((entry, idx) => (
                <TableRow
                  key={entry.id}
                  className={
                    idx % 2 === 0
                      ? "bg-background hover:bg-muted/30"
                      : "bg-muted/20 hover:bg-muted/40"
                  }
                >
                  <TableCell className="tabular-nums text-muted-foreground text-sm">
                    {formatDate(entry.date)}
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {entry.account}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                    {entry.description}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {entry.debit > 0 ? (
                      <span className="text-foreground font-medium">
                        {formatCurrency(entry.debit)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {entry.credit > 0 ? (
                      <span className="text-foreground font-medium">
                        {formatCurrency(entry.credit)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-semibold">
                    {formatCurrency(entry.balance)}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-md bg-muted/50 px-2 py-0.5 text-xs font-mono text-muted-foreground">
                      {entry.reference}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="bg-muted/60 font-semibold border-t-2">
                <TableCell colSpan={3} className="text-sm">
                  Totals
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatCurrency(totalDebits)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatCurrency(totalCredits)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatCurrency(netBalance)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
