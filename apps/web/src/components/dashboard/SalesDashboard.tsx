"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, DollarSign, Clock, BarChart3 } from "lucide-react";
import { useAuthStore } from "@/store/auth.store";
import { formatCurrency, formatDate } from "@/lib/format";
import { deals } from "@/data/mock";

export function SalesDashboard() {
  const user = useAuthStore((s) => s.user);

  // Filter to the currently logged-in user's deals — NOT a hardcoded ID
  const myDeals = useMemo(
    () => deals.filter((d) => d.assignedTo === user?.id),
    [user?.id]
  );

  const openDeals = useMemo(
    () => myDeals.filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost"),
    [myDeals]
  );

  const pipelineValue = useMemo(
    () => openDeals.reduce((s, d) => s + d.value, 0),
    [openDeals]
  );

  const winRate = useMemo(() => {
    const closedDeals = myDeals.filter(
      (d) => d.stage === "closed_won" || d.stage === "closed_lost"
    );
    const wonDeals = myDeals.filter((d) => d.stage === "closed_won");
    return closedDeals.length > 0
      ? Math.round((wonDeals.length / closedDeals.length) * 100)
      : 0;
  }, [myDeals]);

  // Closing this week = due within 7 days from today (not hardcoded)
  const closingThisWeek = useMemo(() => {
    const oneWeekFromNow = new Date();
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
    return openDeals.filter((d) => new Date(d.expectedClose) <= oneWeekFromNow).length;
  }, [openDeals]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="My Open Deals" value={String(openDeals.length)} icon={TrendingUp} trend="neutral" iconColor="text-blue-600" />
        <KPICard title="Pipeline Value" value={formatCurrency(pipelineValue)} icon={DollarSign} trend="up" iconColor="text-green-600" />
        <KPICard title="Closing This Week" value={String(closingThisWeek)} icon={Clock} trend={closingThisWeek > 0 ? "up" : "neutral"} iconColor="text-amber-600" />
        <KPICard title="Win Rate" value={`${winRate}%`} icon={BarChart3} trend={winRate >= 50 ? "up" : "down"} iconColor={winRate >= 50 ? "text-green-600" : "text-red-600"} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">My Deal Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {openDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No open deals assigned to you.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Company</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Expected Close</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openDeals.map((deal) => (
                    <TableRow key={deal.id}>
                      <TableCell className="text-sm font-medium">{deal.company}</TableCell>
                      <TableCell><StatusBadge status={deal.stage} /></TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {formatCurrency(deal.value)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(deal.expectedClose)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
