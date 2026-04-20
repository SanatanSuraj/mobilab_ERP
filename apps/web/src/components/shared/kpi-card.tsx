import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string;
  change?: string;
  trend?: "up" | "down" | "neutral";
  icon: LucideIcon;
  iconColor?: string;
}

export function KPICard({ title, value, change, trend = "neutral", icon: Icon, iconColor = "text-primary" }: KPICardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground font-medium">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {change && (
              <div className="flex items-center gap-1">
                {trend === "up" && <TrendingUp className="h-3.5 w-3.5 text-green-600" />}
                {trend === "down" && <TrendingDown className="h-3.5 w-3.5 text-red-600" />}
                <span className={cn(
                  "text-xs font-medium",
                  trend === "up" && "text-green-600",
                  trend === "down" && "text-red-600",
                  trend === "neutral" && "text-muted-foreground"
                )}>
                  {change}
                </span>
              </div>
            )}
          </div>
          <div className={cn("p-2.5 rounded-lg bg-muted/50", iconColor)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
