import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

/**
 * Empty-state card shown on pages where the real API endpoint hasn't
 * landed yet. Replaces the previous mock-array render so users see why
 * the page is empty instead of silent zeros.
 */
export function AwaitingBackend({
  endpoint,
  note,
}: {
  endpoint?: string;
  note?: string;
}) {
  return (
    <Card className="border-dashed bg-muted/20">
      <CardContent className="py-12 text-center space-y-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Construction className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Awaiting backend</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {note ??
              "This module's API endpoint hasn't shipped yet. Data will appear here once the backend route is live."}
          </p>
          {endpoint && (
            <p className="text-xs font-mono text-muted-foreground pt-1">
              Expected: {endpoint}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
