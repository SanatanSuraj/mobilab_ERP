"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { invoices, Invoice, formatCurrency, formatDate } from "@/data/mock";
import { toast } from "sonner";
import { CreditCard, Building2, Calendar, FileText } from "lucide-react";

export default function PaymentsPage() {
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const unpaidInvoices = invoices.filter(
    (inv) => inv.status === "sent" && !paidIds.has(inv.id)
  );

  function openPaymentDialog(invoice: Invoice) {
    setSelectedInvoice(invoice);
    setPaymentAmount(String(invoice.total));
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setDialogOpen(true);
  }

  function handleRecordPayment() {
    if (!selectedInvoice) return;

    setPaidIds((prev) => new Set([...prev, selectedInvoice.id]));
    setDialogOpen(false);

    toast.success("Payment recorded", {
      description: `${selectedInvoice.invoiceNumber} - ${formatCurrency(Number(paymentAmount))} received on ${formatDate(paymentDate)}`,
    });

    setSelectedInvoice(null);
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Record Payments"
        description="Record payments against outstanding invoices"
      />

      {unpaidInvoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CreditCard className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-lg font-medium">No pending invoices</p>
            <p className="text-sm text-muted-foreground mt-1">
              All sent invoices have been paid
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {unpaidInvoices.map((inv) => (
            <Card
              key={inv.id}
              className="hover:shadow-md transition-shadow"
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-lg bg-muted/50">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">
                          {inv.invoiceNumber}
                        </span>
                        <StatusBadge status={inv.status} />
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {inv.customer}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Due {formatDate(inv.dueDate)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg font-bold tabular-nums">
                        {formatCurrency(inv.total)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Balance due
                      </p>
                    </div>
                    <Button onClick={() => openPaymentDialog(inv)}>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Record Payment
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Recording payment for {selectedInvoice?.invoiceNumber} -{" "}
              {selectedInvoice?.customer}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Payment Amount</Label>
              <Input
                id="amount"
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="Enter amount"
              />
              {selectedInvoice && (
                <p className="text-xs text-muted-foreground">
                  Invoice total: {formatCurrency(selectedInvoice.total)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Payment Date</Label>
              <Input
                id="date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleRecordPayment}>
              <CreditCard className="h-4 w-4 mr-2" />
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
