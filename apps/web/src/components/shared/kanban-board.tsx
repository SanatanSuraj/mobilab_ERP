"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";

export interface KanbanColumn<T> {
  id: string;
  title: string;
  color?: string;
  items: T[];
}

interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[];
  renderCard: (item: T) => React.ReactNode;
  onMoveItem?: (itemId: string, fromColumn: string, toColumn: string) => void;
  getItemId: (item: T) => string;
}

export function KanbanBoard<T>({ columns, renderCard, onMoveItem, getItemId }: KanbanBoardProps<T>) {
  const [dragItem, setDragItem] = useState<{ id: string; fromColumn: string } | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div
          key={col.id}
          className={cn(
            "flex-shrink-0 w-[300px] rounded-xl border bg-muted/30 transition-colors",
            dragOverColumn === col.id && "ring-2 ring-primary/30 bg-primary/5"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverColumn(col.id);
          }}
          onDragLeave={() => setDragOverColumn(null)}
          onDrop={() => {
            if (dragItem && dragItem.fromColumn !== col.id) {
              onMoveItem?.(dragItem.id, dragItem.fromColumn, col.id);
            }
            setDragItem(null);
            setDragOverColumn(null);
          }}
        >
          <div className="p-3 flex items-center justify-between border-b">
            <div className="flex items-center gap-2">
              {col.color && <div className={cn("w-2 h-2 rounded-full")} style={{ backgroundColor: col.color }} />}
              <h3 className="font-semibold text-sm">{col.title}</h3>
            </div>
            <Badge variant="secondary" className="text-xs">{col.items.length}</Badge>
          </div>
          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="p-2 space-y-2">
              {col.items.map((item) => (
                <div
                  key={getItemId(item)}
                  draggable
                  onDragStart={() => setDragItem({ id: getItemId(item), fromColumn: col.id })}
                  onDragEnd={() => { setDragItem(null); setDragOverColumn(null); }}
                  className={cn(
                    "cursor-grab active:cursor-grabbing group",
                    dragItem?.id === getItemId(item) && "opacity-50"
                  )}
                >
                  <div className="relative">
                    <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </div>
                    {renderCard(item)}
                  </div>
                </div>
              ))}
              {col.items.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  Drop items here
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      ))}
    </div>
  );
}
