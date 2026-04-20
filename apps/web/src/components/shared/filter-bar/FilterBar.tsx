"use client";

import React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FilterOption = { value: string; label: string };

export type FilterConfig = {
  key: string;
  placeholder: string;
  options: FilterOption[];
  width?: string;
};

export type FilterBarProps = {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: FilterConfig[];
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
  actions?: React.ReactNode;
};

export function FilterBar({
  searchPlaceholder = "Search...",
  searchValue = "",
  onSearchChange,
  filters = [],
  filterValues = {},
  onFilterChange,
  actions,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search input */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-8"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange?.(e.target.value)}
        />
      </div>

      {/* Filter dropdowns */}
      {filters.map((filter) => (
        <Select
          key={filter.key}
          value={filterValues[filter.key] ?? "ALL"}
          onValueChange={(v) => onFilterChange?.(filter.key, v ?? "ALL")}
        >
          <SelectTrigger
            style={filter.width ? { width: filter.width } : { width: "160px" }}
          >
            <SelectValue placeholder={filter.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {filter.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {/* Right-side action buttons */}
      {actions && <div className="ml-auto flex items-center gap-3">{actions}</div>}
    </div>
  );
}
