"use client";

import React from "react";
import { AlertCircle, Inbox } from "lucide-react";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
};

export type EntityTableProps<T extends { id: string }> = {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  rowClassName?: (row: T) => string;
  caption?: string;
};

export function EntityTable<T extends { id: string }>({
  columns,
  data,
  onRowClick,
  isLoading = false,
  error = null,
  emptyMessage = "No records found.",
  emptyAction,
  rowClassName,
  caption,
}: EntityTableProps<T>) {
  const alignClass = (align?: "left" | "right" | "center") => {
    if (align === "right") return "text-right";
    if (align === "center") return "text-center";
    return "text-left";
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Table>
      {caption && <TableCaption>{caption}</TableCaption>}
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead
              key={col.key}
              style={col.width ? { width: col.width } : undefined}
              className={alignClass(col.align)}
            >
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col.key}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length}>
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                {emptyAction && <div>{emptyAction}</div>}
              </div>
            </TableCell>
          </TableRow>
        ) : (
          data.map((row) => (
            <TableRow
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                onRowClick && "cursor-pointer hover:bg-muted/60",
                rowClassName ? rowClassName(row) : undefined
              )}
            >
              {columns.map((col) => (
                <TableCell key={col.key} className={alignClass(col.align)}>
                  {col.render
                    ? col.render(row)
                    : String((row as Record<string, unknown>)[col.key] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
