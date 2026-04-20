"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { orders, getAccountById } from "@/data/crm-mock";
import { formatCurrency, formatDate } from "@/data/mock";
import { ArrowLeft } from "lucide-react";

export default function PortalOrdersPage() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <Link
        href="/portal"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Portal
      </Link>

      <PageHeader
        title="Order History"
        description="View your past and current orders"
      />

      <Card>
        <CardContent className="p-0">
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Order #</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium text-sm">
                      {order.orderNumber}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.items.map((i) => i.productName).join(", ")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(order.orderDate)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {formatCurrency(order.grandTotal)}
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No orders found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
