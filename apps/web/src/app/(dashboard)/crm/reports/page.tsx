"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deals, formatCurrency } from "@/data/mock";
import { enhancedLeads, accounts } from "@/data/crm-mock";
import { BarChart3, TrendingUp, Funnel, DollarSign } from "lucide-react";

const stageLabels: Record<string, string> = {
  discovery: "Discovery",
  proposal: "Proposal",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

const stageColors: Record<string, string> = {
  discovery: "bg-cyan-500",
  proposal: "bg-orange-500",
  negotiation: "bg-amber-500",
  closed_won: "bg-green-500",
  closed_lost: "bg-red-500",
};

const leadStatusLabels: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
};

export default function CrmReportsPage() {
  // Pipeline data
  const pipelineValue = deals
    .filter((d) => d.stage !== "closed_lost")
    .reduce((sum, d) => sum + d.value, 0);
  const stageCounts = deals.reduce((acc, d) => {
    acc[d.stage] = (acc[d.stage] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const maxStageCount = Math.max(...Object.values(stageCounts));
  const avgDealSize = Math.round(
    deals.reduce((sum, d) => sum + d.value, 0) / deals.length
  );

  // Win/Loss data
  const wonDeals = deals.filter((d) => d.stage === "closed_won");
  const lostDeals = deals.filter((d) => d.stage === "closed_lost");
  const closedDeals = wonDeals.length + lostDeals.length;
  const winRate = closedDeals > 0 ? Math.round((wonDeals.length / closedDeals) * 100) : 0;
  const wonValue = wonDeals.reduce((sum, d) => sum + d.value, 0);
  const lostValue = lostDeals.reduce((sum, d) => sum + d.value, 0);

  // Lead funnel data
  const leadCounts = enhancedLeads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const funnelStages = ["new", "contacted", "qualified", "converted"];
  const funnelMax = Math.max(
    ...funnelStages.map((s) => leadCounts[s] || 0),
    1
  );

  // Revenue mock data
  const revenueByProduct = [
    { product: "BioSense Glucose Monitor", unitsSold: 150, revenue: 675000 },
    { product: "HemaCheck Analyzer Kit", unitsSold: 56, revenue: 672000 },
    { product: "Reagent Pack Alpha", unitsSold: 800, revenue: 640000 },
    { product: "MicroPlate Reader 96", unitsSold: 10, revenue: 850000 },
    { product: "Reagent Pack Beta", unitsSold: 500, revenue: 600000 },
  ];
  const monthlyRevenue = [
    { month: "Sep", amount: 320000 },
    { month: "Oct", amount: 480000 },
    { month: "Nov", amount: 560000 },
    { month: "Dec", amount: 420000 },
    { month: "Jan", amount: 780000 },
    { month: "Feb", amount: 650000 },
  ];
  const maxMonthly = Math.max(...monthlyRevenue.map((m) => m.amount));

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="CRM Reports"
        description="Pipeline analytics, win/loss analysis, and revenue insights"
      />

      <Tabs defaultValue="pipeline">
        <TabsList>
          <TabsTrigger value="pipeline">
            <BarChart3 className="h-4 w-4 mr-1.5" />
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="winloss">
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Win/Loss
          </TabsTrigger>
          <TabsTrigger value="funnel">
            <Funnel className="h-4 w-4 mr-1.5" />
            Lead Funnel
          </TabsTrigger>
          <TabsTrigger value="revenue">
            <DollarSign className="h-4 w-4 mr-1.5" />
            Revenue
          </TabsTrigger>
        </TabsList>

        {/* PIPELINE */}
        <TabsContent value="pipeline" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5 text-center">
                <p className="text-sm text-muted-foreground">Total Pipeline</p>
                <p className="text-2xl font-bold mt-1">
                  {formatCurrency(pipelineValue)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 text-center">
                <p className="text-sm text-muted-foreground">Avg Deal Size</p>
                <p className="text-2xl font-bold mt-1">
                  {formatCurrency(avgDealSize)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 text-center">
                <p className="text-sm text-muted-foreground">Avg Close Time</p>
                <p className="text-2xl font-bold mt-1">45 days</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Deals by Stage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(stageCounts).map(([stage, count]) => (
                  <div key={stage} className="flex items-center gap-3">
                    <span className="text-sm w-28 text-muted-foreground">
                      {stageLabels[stage] ?? stage}
                    </span>
                    <div className="flex-1 bg-muted rounded-full h-7 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          stageColors[stage] ?? "bg-gray-500"
                        } flex items-center px-2 transition-all`}
                        style={{
                          width: `${Math.max((count / maxStageCount) * 100, 10)}%`,
                        }}
                      >
                        <span className="text-xs font-medium text-white">
                          {count}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* WIN/LOSS */}
        <TabsContent value="winloss" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-sm text-muted-foreground mb-2">Win Rate</p>
              <p className="text-6xl font-bold text-green-600">{winRate}%</p>
              <p className="text-sm text-muted-foreground mt-2">
                {wonDeals.length} won out of {closedDeals} closed deals
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card className="border-green-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-green-700">
                  Won Deals
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">
                  {wonDeals.length}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Total: {formatCurrency(wonValue)}
                </p>
                <div className="mt-3 space-y-1">
                  {wonDeals.map((d) => (
                    <p key={d.id} className="text-xs text-muted-foreground">
                      {d.title} - {formatCurrency(d.value)}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="border-red-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-red-700">
                  Lost Deals
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">
                  {lostDeals.length}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Total: {formatCurrency(lostValue)}
                </p>
                <div className="mt-3 space-y-1">
                  {lostDeals.map((d) => (
                    <p key={d.id} className="text-xs text-muted-foreground">
                      {d.title} - {formatCurrency(d.value)}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Lost Reasons</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm">
                        Competitor - Lower pricing
                      </TableCell>
                      <TableCell className="text-right text-sm">1</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm">Budget constraints</TableCell>
                      <TableCell className="text-right text-sm">0</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm">
                        No response / Ghosted
                      </TableCell>
                      <TableCell className="text-right text-sm">0</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* LEAD FUNNEL */}
        <TabsContent value="funnel" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Lead Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center gap-2 py-4">
                {funnelStages.map((stage, idx) => {
                  const count = leadCounts[stage] || 0;
                  const widthPct = Math.max(
                    100 - idx * 20,
                    30
                  );
                  const colors = [
                    "bg-blue-500",
                    "bg-indigo-500",
                    "bg-purple-500",
                    "bg-green-500",
                  ];
                  return (
                    <div
                      key={stage}
                      className={`${colors[idx]} rounded-lg h-12 flex items-center justify-center transition-all`}
                      style={{ width: `${widthPct}%` }}
                    >
                      <span className="text-white text-sm font-medium">
                        {leadStatusLabels[stage]} ({count})
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Conversion Rates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {funnelStages.slice(0, -1).map((stage, idx) => {
                  const from = leadCounts[stage] || 0;
                  const to = leadCounts[funnelStages[idx + 1]] || 0;
                  const rate = from > 0 ? Math.round((to / from) * 100) : 0;
                  return (
                    <div key={stage} className="flex items-center gap-3">
                      <span className="text-sm w-44 text-muted-foreground">
                        {leadStatusLabels[stage]} → {leadStatusLabels[funnelStages[idx + 1]]}
                      </span>
                      <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/70 flex items-center px-2 transition-all"
                          style={{ width: `${Math.max(rate, 5)}%` }}
                        >
                          <span className="text-[10px] font-medium text-white">
                            {rate}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* REVENUE */}
        <TabsContent value="revenue" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Revenue by Product</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Units Sold</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueByProduct.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-sm font-medium">
                          {item.product}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {item.unitsSold}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatCurrency(item.revenue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Monthly Revenue Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3 h-48">
                {monthlyRevenue.map((m) => (
                  <div
                    key={m.month}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {formatCurrency(m.amount)}
                    </span>
                    <div
                      className="w-full bg-primary/80 rounded-t-md transition-all hover:bg-primary"
                      style={{
                        height: `${(m.amount / maxMonthly) * 160}px`,
                      }}
                    />
                    <span className="text-xs font-medium text-muted-foreground">
                      {m.month}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
