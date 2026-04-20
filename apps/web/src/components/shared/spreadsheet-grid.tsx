"use client";

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SpreadsheetGridProps {
  initialData: string[][];
  headers: string[];
  readOnly?: boolean;
}

export function SpreadsheetGrid({ initialData, headers, readOnly = false }: SpreadsheetGridProps) {
  const [data, setData] = useState(initialData);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = useCallback((row: number, col: number) => {
    if (readOnly) return;
    setSelectedCell({ row, col });
    setEditValue(data[row][col]);
  }, [data, readOnly]);

  const commitEdit = useCallback(() => {
    if (!selectedCell) return;
    const newData = data.map((r) => [...r]);
    newData[selectedCell.row][selectedCell.col] = editValue;
    setData(newData);
    setSelectedCell(null);
  }, [selectedCell, editValue, data]);

  const colLetters = headers.length > 0 ? headers : Array.from({ length: data[0]?.length || 0 }, (_, i) => String.fromCharCode(65 + i));

  return (
    <div className="border rounded-lg overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-r bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground w-12 sticky left-0">#</th>
            {colLetters.map((h, i) => (
              <th key={i} className="border-b border-r bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground min-w-[120px]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, ri) => (
            <tr key={ri} className="hover:bg-muted/30">
              <td className="border-b border-r bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground font-mono sticky left-0">
                {ri + 1}
              </td>
              {row.map((cell, ci) => {
                const isEditing = selectedCell?.row === ri && selectedCell?.col === ci;
                return (
                  <td
                    key={ci}
                    className={cn(
                      "border-b border-r px-0 py-0 relative",
                      selectedCell?.row === ri && selectedCell?.col === ci && "ring-2 ring-primary ring-inset"
                    )}
                    onDoubleClick={() => startEdit(ri, ci)}
                    onClick={() => setSelectedCell({ row: ri, col: ci })}
                  >
                    {isEditing ? (
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") setSelectedCell(null);
                        }}
                        className="h-full w-full border-0 rounded-none focus-visible:ring-0 text-sm px-3 py-1.5"
                        autoFocus
                      />
                    ) : (
                      <div className="px-3 py-1.5 min-h-[32px] text-sm">
                        {cell}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
