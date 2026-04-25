"use client";

import { useEffect, useMemo, useState } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp, DollarSign, Clock, BarChart3 } from "lucide-react";
import { useApiDeals } from "@/hooks/useCrmApi";
import { getTenantUserId } from "@/lib/api/tenant-fetch";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Deal } from "@instigenie/contracts";

/**
 * Per-rep sales dashboard — live data from /crm/deals filtered by `assignedTo`.
 *
 * The filter is pushed to the server (DealListQuery.assignedTo) rather than
 * fetching all deals and filtering client-side. The tenant user id comes from
 * the JWT `sub` claim; the mock Zustand user is ignored because the two
 * identity spaces don't match.
 */

const OPEN_STAGES: Deal["stage"][] = ["DISCOVERY", "PROPOSAL", "NEGOTIATION"];
const CLOSED_STAGES: Deal["stage"][] = ["CLOSED_WON", "CLOSED_LOST"];

function toNumber(v: string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function SalesDashboard() {
  // The JWT is only readable client-side, so defer the id read to an effect
  // to avoid a hydration mismatch.
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    setUserId(getTenantUserId());
  }, []);

  const query = useMemo(
    () => (userId ? { assignedTo: userId, limit: 100 } : { limit: 0 }),
    [userId]
  );
  const dealsQuery = useApiDeals(query);
  const myDeals = useMemo(
    () => (userId ? (dealsQuery.data?.data ?? []) : []),
    [dealsQuery.data?.data, userId]
  );

  const openDeals = useMemo(
    () => myDeals.filter((d) => OPEN_STAGES.includes(d.stage)),
    [myDeals]
  );

  const pipelineValue = useMemo(
    () => openDeals.reduce((s, d) => s + toNumber(d.value), 0),
    [openDeals]
  );

  const winRate = useMemo(() => {
    const closed = myDeals.filter((d) => CLOSED_STAGES.includes(d.stage));
    const won = myDeals.filter((d) => d.stage === "CLOSED_WON");
    return closed.length > 0
      ? Math.round((won.length / closed.length) * 100)
      : 0;
  }, [myDeals]);

  const closingThisWeek = useMemo(() => {
    const oneWeekFromNow = new Date();
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
    return openDeals.filter((d) => {
      if (!d.expectedClose) return false;
      return new Date(d.expectedClose) <= oneWeekFromNow;
    }).length;
  }, [openDeals]);

  if (dealsQuery.isLoading || userId === null) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="My Open Deals"
          value={String(openDeals.length)}
          icon={TrendingUp}
          trend="neutral"
          iconColor="text-blue-600"
        />
        <KPICard
          title="Pipeline Value"
          value={formatCurrency(pipelineValue)}
          icon={DollarSign}
          trend="up"
          iconColor="text-green-600"
        />
        <KPICard
          title="Closing This Week"
          value={String(closingThisWeek)}
          icon={Clock}
          trend={closingThisWeek > 0 ? "up" : "neutral"}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Win Rate"
          value={`${winRate}%`}
          icon={BarChart3}
          trend={winRate >= 50 ? "up" : "down"}
          iconColor={winRate >= 50 ? "text-green-600" : "text-red-600"}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            My Deal Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          {openDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No open deals assigned to you.
            </p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Company</TableHead>
                    <TableHead>Deal</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Expected Close</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openDeals.map((deal) => (
                    <TableRow key={deal.id}>
                      <TableCell className="text-sm font-medium">
                        {deal.company}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {deal.title}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={deal.stage} />
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {formatCurrency(toNumber(deal.value))}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {deal.expectedClose
                          ? formatDate(deal.expectedClose)
                          : "—"}
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
