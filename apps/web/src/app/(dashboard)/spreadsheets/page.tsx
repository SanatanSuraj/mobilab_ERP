"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { SpreadsheetGrid } from "@/components/shared/spreadsheet-grid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Download, Table2 } from "lucide-react";
import { products, deals, invoices, formatCurrency } from "@/data/mock";

// Pre-built spreadsheet data from mock modules
const salesData = [
  ["Deal", "Company", "Stage", "Value", "Probability", "Expected Close"],
  ...deals.map((d) => [d.title, d.company, d.stage, formatCurrency(d.value), `${d.probability}%`, d.expectedClose]),
];

const inventoryData = [
  ["Product", "SKU", "Category", "Price", "Stock", "Warehouse"],
  ...products.map((p) => [p.name, p.sku, p.category, formatCurrency(p.price), String(p.stock), p.warehouse]),
];

const invoiceData = [
  ["Invoice #", "Customer", "Status", "Subtotal", "Tax", "Total", "Due Date"],
  ...invoices.map((i) => [i.invoiceNumber, i.customer, i.status, formatCurrency(i.subtotal), formatCurrency(i.tax), formatCurrency(i.total), i.dueDate]),
];

const summaryData = [
  ["Metric", "Value", "Change", "Period"],
  ["Total Revenue", formatCurrency(1340000), "+12%", "Q1 2026"],
  ["Active Deals", "3", "+2", "This Month"],
  ["Pipeline Value", formatCurrency(2570000), "+18%", "Current"],
  ["Avg Deal Size", formatCurrency(570000), "-3%", "Q1 2026"],
  ["Win Rate", "67%", "+5%", "Last 6 months"],
  ["Inventory Value", formatCurrency(products.reduce((s, p) => s + p.price * p.stock, 0)), "+8%", "Current"],
  ["Open Invoices", formatCurrency(invoices.filter((i) => i.status !== "paid").reduce((s, i) => s + i.total, 0)), "", "Current"],
  ["Products", String(products.length), "", "Total"],
];

const sheets = [
  { id: "summary", name: "Business Summary", headers: summaryData[0], data: summaryData.slice(1) },
  { id: "sales", name: "Sales Pipeline", headers: salesData[0], data: salesData.slice(1) },
  { id: "inventory", name: "Inventory", headers: inventoryData[0], data: inventoryData.slice(1) },
  { id: "invoices", name: "Invoices", headers: invoiceData[0], data: invoiceData.slice(1) },
];

export default function SpreadsheetsPage() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Spreadsheets"
        description="View and analyze data from all modules"
        actions={
          <div className="flex gap-2">
            <Button variant="outline"><Download className="h-4 w-4 mr-2" /> Export</Button>
            <Button><Plus className="h-4 w-4 mr-2" /> New Sheet</Button>
          </div>
        }
      />

      <Tabs defaultValue="summary">
        <TabsList>
          {sheets.map((s) => (
            <TabsTrigger key={s.id} value={s.id} className="gap-1.5">
              <Table2 className="h-3.5 w-3.5" />
              {s.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {sheets.map((sheet) => (
          <TabsContent key={sheet.id} value={sheet.id} className="mt-4">
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">{sheet.name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">{sheet.data.length} rows - Double-click to edit cells</p>
                </div>
                <Badge variant="secondary">{sheet.data.length} records</Badge>
              </CardHeader>
              <CardContent>
                <SpreadsheetGrid
                  headers={sheet.headers}
                  initialData={sheet.data}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Formula bar (mocked) */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="font-mono text-xs">fx</Badge>
            <code className="text-sm text-muted-foreground font-mono">
              =SUM(D2:D{deals.length + 1}) → {formatCurrency(deals.reduce((s, d) => s + d.value, 0))}
            </code>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Formula engine: basic SUM, AVG, COUNT supported (mocked)</p>
        </CardContent>
      </Card>
    </div>
  );
}
