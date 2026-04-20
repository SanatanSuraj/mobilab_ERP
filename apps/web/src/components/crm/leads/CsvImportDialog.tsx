"use client";

/**
 * CsvImportDialog — bulk-import leads from a CSV file.
 *
 * CSV format (first row = header, order flexible):
 *   name, company, email, phone, source, value
 *
 * Example:
 *   name,company,email,phone,source,value
 *   Dr. Ravi Shankar,AIIMS Bhopal,ravi@aiims.in,+91 98000 11111,Trade Show,850000
 *
 * Dedup: rows matching an existing lead's email OR phone are flagged,
 * shown to the user, and still imported (marked isDuplicate in the DB).
 */

import { useRef, useState } from "react";
import { Upload, AlertTriangle, CheckCircle2, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useImportLeads } from "@/hooks/useCrm";
import type { CreateLeadInput } from "@/services/crm.service";

// ─── CSV Parser ───────────────────────────────────────────────────────────────

const HEADER_MAP: Record<string, string> = {
  name: "name", "full name": "name", contact: "name",
  company: "company", hospital: "company", organization: "company", org: "company",
  email: "email", "email address": "email",
  phone: "phone", mobile: "phone", "phone number": "phone",
  source: "source", "lead source": "source", channel: "source",
  value: "estimatedValue", "estimated value": "estimatedValue", amount: "estimatedValue",
};

interface ParsedRow {
  raw: Record<string, string>;
  mapped: Partial<CreateLeadInput>;
  errors: string[];
  isDuplicate?: boolean;
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV split — handles unquoted fields only (prototype-grade)
    const values = lines[i].split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h] = values[idx] ?? "";
    });

    const mapped: Partial<CreateLeadInput> = {};
    Object.entries(raw).forEach(([h, v]) => {
      const key = HEADER_MAP[h];
      if (key === "estimatedValue") {
        (mapped as Record<string, unknown>)[key] = parseFloat(v.replace(/[^0-9.]/g, "")) || 0;
      } else if (key) {
        (mapped as Record<string, unknown>)[key] = v;
      }
    });

    const errors: string[] = [];
    if (!mapped.name?.trim()) errors.push("Missing name");
    if (!mapped.company?.trim()) errors.push("Missing company");
    if (!mapped.email?.trim()) errors.push("Missing email");
    if (!mapped.phone?.trim()) errors.push("Missing phone");

    rows.push({ raw, mapped, errors });
  }

  return rows;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "upload" | "preview" | "done";

export function CsvImportDialog({ open, onOpenChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const importLeads = useImportLeads();

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);

  function handleFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCsv(text);
      setRows(parsed);
      setStep("preview");
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".csv")) handleFile(file);
  }

  async function handleImport() {
    const inputs: CreateLeadInput[] = validRows.map((r) => ({
      name: r.mapped.name ?? "",
      company: r.mapped.company ?? "",
      email: r.mapped.email ?? "",
      phone: r.mapped.phone ?? "",
      source: r.mapped.source ?? "Import",
      assignedTo: "u2", // default — round-robin in real API
      estimatedValue: (r.mapped.estimatedValue as number) ?? 0,
    }));

    try {
      const result = await importLeads.mutateAsync(inputs);
      toast.success(`${result.created} leads imported`, {
        description: result.duplicates > 0
          ? `${result.duplicates} flagged as possible duplicates.`
          : "All leads are unique.",
      });
      setStep("done");
    } catch {
      toast.error("Import failed. Check the file and try again.");
    }
  }

  function handleClose() {
    setStep("upload");
    setRows([]);
    setFileName("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import Leads from CSV
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Upload ── */}
        {step === "upload" && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <FileText className="h-10 w-10 text-muted-foreground/50" />
              <div className="text-center">
                <p className="text-sm font-medium">Drop your CSV here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Columns: name, company, email, phone, source, value
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>

            {/* Sample CSV hint */}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Sample CSV format:</p>
              <code className="text-xs text-muted-foreground leading-relaxed block whitespace-pre">
                {`name,company,email,phone,source,value\nDr. Ravi Shankar,AIIMS Bhopal,ravi@aiims.in,+91 98000 11111,Trade Show,850000`}
              </code>
            </div>
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {step === "preview" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{fileName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {validRows.length} valid
                </Badge>
                {invalidRows.length > 0 && (
                  <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {invalidRows.length} errors
                  </Badge>
                )}
              </div>
            </div>

            {/* Preview table */}
            <div className="border rounded-lg overflow-auto max-h-64">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Name</th>
                    <th className="text-left px-3 py-2 font-medium">Company</th>
                    <th className="text-left px-3 py-2 font-medium">Email</th>
                    <th className="text-left px-3 py-2 font-medium">Phone</th>
                    <th className="text-left px-3 py-2 font-medium">Source</th>
                    <th className="text-right px-3 py-2 font-medium">Value</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className={`border-t ${row.errors.length > 0 ? "bg-red-50/50" : ""}`}>
                      <td className="px-3 py-1.5">{row.mapped.name ?? <span className="text-destructive">—</span>}</td>
                      <td className="px-3 py-1.5">{row.mapped.company ?? "—"}</td>
                      <td className="px-3 py-1.5">{row.mapped.email ?? "—"}</td>
                      <td className="px-3 py-1.5">{row.mapped.phone ?? "—"}</td>
                      <td className="px-3 py-1.5">{row.mapped.source ?? "Import"}</td>
                      <td className="px-3 py-1.5 text-right">
                        {row.mapped.estimatedValue
                          ? `₹${Number(row.mapped.estimatedValue).toLocaleString("en-IN")}`
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        {row.errors.length > 0 && (
                          <span title={row.errors.join(", ")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {invalidRows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                ⚠ Rows with errors will be skipped. Fix the CSV and re-upload to include them.
              </p>
            )}
          </div>
        )}

        {/* ── Step 3: Done ── */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            </div>
            <h3 className="text-base font-semibold">Import complete</h3>
            <p className="text-sm text-muted-foreground">
              {validRows.length} leads added to your pipeline.
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>
                <X className="h-4 w-4 mr-2" />
                Re-upload
              </Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0 || importLeads.isPending}
              >
                {importLeads.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</>
                  : `Import ${validRows.length} leads`}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
