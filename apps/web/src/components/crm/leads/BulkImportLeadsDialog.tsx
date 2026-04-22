"use client";

/**
 * BulkImportLeadsDialog — real-API spreadsheet import for leads.
 *
 * Replaces the legacy mock-backed CsvImportDialog. Differences:
 *   - Uses the new POST /crm/leads/bulk endpoint (see LeadsService.bulkCreate).
 *   - Accepts BOTH .csv and .xlsx (parsed client-side via SheetJS).
 *   - Columns are auto-mapped from a handful of common header aliases —
 *     no mapping UI, keeps the happy path to one click.
 *   - Per-row client-side validation (name / company / email / phone
 *     required, value parsed as a decimal string to match contracts).
 *   - Preview table shows every row; invalid rows are flagged and skipped
 *     from submission without blocking valid ones.
 *   - "Skip duplicates" toggle maps to the body's `skipDuplicates` flag —
 *     default false so imports are additive (match the single-create path).
 *   - "Download template" synthesises a .xlsx with the expected headers
 *     plus one demo row so the user gets a valid file to edit offline.
 *
 * Submission returns per-row statuses (`created` / `duplicate_skipped` /
 * `failed`); the "done" step renders those counts + a scrollable list for
 * any failed rows so the user can reconcile.
 */

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { useApiBulkCreateLeads } from "@/hooks/useCrmApi";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import type {
  BulkCreateLeadsResponse,
  CreateLead,
} from "@instigenie/contracts";

// ─── Column mapping ─────────────────────────────────────────────────────────
//
// Keys are normalized headers (lower-cased, trimmed); values are the
// `CreateLead` field name. If a column's header doesn't appear here the
// value is ignored. Only `name`, `company`, `email`, `phone` are required
// for validation.

const HEADER_MAP: Record<string, keyof CreateLead> = {
  name: "name",
  "full name": "name",
  contact: "name",
  "contact name": "name",
  company: "company",
  hospital: "company",
  organization: "company",
  org: "company",
  email: "email",
  "email address": "email",
  phone: "phone",
  mobile: "phone",
  "phone number": "phone",
  source: "source",
  "lead source": "source",
  channel: "source",
  value: "estimatedValue",
  "estimated value": "estimatedValue",
  amount: "estimatedValue",
};

const TEMPLATE_HEADERS = [
  "name",
  "company",
  "email",
  "phone",
  "source",
  "estimatedValue",
];

const TEMPLATE_SAMPLE_ROW: Record<string, string> = {
  name: "Dr. Ravi Shankar",
  company: "AIIMS Bhopal",
  email: "ravi@aiims.in",
  phone: "+91 98000 11111",
  source: "Trade Show",
  estimatedValue: "850000",
};

// ─── Parsing ────────────────────────────────────────────────────────────────

interface ParsedRow {
  /** 1-based row number as it appears in the spreadsheet (header is row 1). */
  sheetRowNumber: number;
  /** Mapped, trimmed, stringified cell values. */
  mapped: Partial<Record<keyof CreateLead, string>>;
  /** Client-side validation errors. Empty → row is submittable. */
  errors: string[];
}

/** Normalize a spreadsheet cell to a trimmed string. */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") {
    // XLSX returns numbers for numeric cells (including phone-looking ones
    // if the sheet's format is wrong). Integer stringification avoids
    // scientific notation on phones; decimals round-trip via toString.
    return Number.isInteger(v) ? v.toString() : v.toString();
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

/** Decimal validator: matches the server-side regex in contracts. */
const DECIMAL_RE = /^-?\d+(\.\d+)?$/u;

function validateRow(
  mapped: Partial<Record<keyof CreateLead, string>>
): string[] {
  const errors: string[] = [];
  if (!mapped.name?.trim()) errors.push("Missing name");
  if (!mapped.company?.trim()) errors.push("Missing company");
  if (!mapped.email?.trim()) errors.push("Missing email");
  else if (!/.+@.+\..+/.test(mapped.email)) errors.push("Invalid email");
  if (!mapped.phone?.trim()) errors.push("Missing phone");
  if (mapped.estimatedValue && mapped.estimatedValue.trim() !== "") {
    // Strip thousands separators / currency symbols before validation.
    const cleaned = mapped.estimatedValue
      .replace(/[₹$,\s]/g, "")
      .replace(/\.$/, "");
    if (!DECIMAL_RE.test(cleaned)) errors.push("Invalid value");
  }
  return errors;
}

/**
 * Parse a File into normalised rows. Uses SheetJS which handles both
 * .csv and .xlsx (it auto-detects from magic bytes). We grab the first
 * worksheet only — multi-sheet uploads are out of scope for the MVP.
 */
async function parseFile(file: File): Promise<ParsedRow[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName]!;

  // `{header: 1}` gives us an array-of-arrays — easier to detect headers
  // and know the sheet row number without relying on auto-generated keys.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (aoa.length < 2) return [];

  const rawHeaders = (aoa[0] ?? []).map((h) =>
    cellToString(h).toLowerCase()
  );
  // Map header index → CreateLead field (or null if unrecognised).
  const headerMap = rawHeaders.map((h) => HEADER_MAP[h] ?? null);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const mapped: Partial<Record<keyof CreateLead, string>> = {};
    for (let c = 0; c < headerMap.length; c++) {
      const field = headerMap[c];
      if (!field) continue;
      const value = cellToString(row[c]);
      if (value !== "") mapped[field] = value;
    }
    // Skip fully-empty rows silently — Excel files often trail them.
    const anyValue = Object.values(mapped).some(
      (v) => typeof v === "string" && v.trim() !== ""
    );
    if (!anyValue) continue;

    rows.push({
      sheetRowNumber: i + 1, // +1 because XLSX is 1-indexed and header = row 1
      mapped,
      errors: validateRow(mapped),
    });
  }
  return rows;
}

// ─── Template download ──────────────────────────────────────────────────────

function downloadTemplate(): void {
  const ws = XLSX.utils.json_to_sheet([TEMPLATE_SAMPLE_ROW], {
    header: TEMPLATE_HEADERS,
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  XLSX.writeFile(wb, "leads-import-template.xlsx");
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "upload" | "preview" | "done";

/**
 * Build a CreateLead body from a ParsedRow. Assumes the row has already
 * passed validateRow() (errors.length === 0). Normalizes estimatedValue
 * to the contract's decimal-string shape.
 */
function toCreateLead(row: ParsedRow): CreateLead {
  const mapped = row.mapped;
  // Clean up numeric value if present; fall back to "0" per the schema default.
  let estimatedValue = "0";
  if (mapped.estimatedValue && mapped.estimatedValue.trim() !== "") {
    const cleaned = mapped.estimatedValue.replace(/[₹$,\s]/g, "");
    estimatedValue = cleaned || "0";
  }
  return {
    name: mapped.name!.trim(),
    company: mapped.company!.trim(),
    email: mapped.email!.trim(),
    phone: mapped.phone!.trim(),
    source: mapped.source?.trim() || "Bulk import",
    estimatedValue,
  };
}

export function BulkImportLeadsDialog({ open, onOpenChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [result, setResult] = useState<BulkCreateLeadsResponse | null>(null);

  const bulkCreate = useApiBulkCreateLeads();

  const validRows = useMemo(
    () => rows.filter((r) => r.errors.length === 0),
    [rows]
  );
  const invalidRows = useMemo(
    () => rows.filter((r) => r.errors.length > 0),
    [rows]
  );

  function handleFile(file: File): void {
    const extOk = /\.(csv|xlsx|xls)$/i.test(file.name);
    if (!extOk) {
      setParseError("Unsupported file type. Please upload a .csv or .xlsx file.");
      return;
    }
    setFileName(file.name);
    setParseError(null);
    setIsParsing(true);
    parseFile(file)
      .then((parsed) => {
        if (parsed.length === 0) {
          setParseError(
            "No data rows found. Make sure the first row contains column headers."
          );
          setRows([]);
        } else {
          setRows(parsed);
          setStep("preview");
        }
      })
      .catch((err: unknown) => {
        setParseError(
          err instanceof Error
            ? `Couldn't parse file: ${err.message}`
            : "Couldn't parse file."
        );
        setRows([]);
      })
      .finally(() => setIsParsing(false));
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function handleImport(): Promise<void> {
    if (validRows.length === 0) return;
    const leads = validRows.map(toCreateLead);
    try {
      const res = await bulkCreate.mutateAsync({ leads, skipDuplicates });
      setResult(res);
      setStep("done");
      if (res.created > 0) {
        toast.success(
          `${res.created} lead${res.created === 1 ? "" : "s"} imported`,
          {
            description:
              res.failed > 0
                ? `${res.failed} row${res.failed === 1 ? "" : "s"} failed — see summary.`
                : res.duplicatesSkipped > 0
                ? `${res.duplicatesSkipped} duplicate${
                    res.duplicatesSkipped === 1 ? "" : "s"
                  } skipped.`
                : "All rows succeeded.",
          }
        );
      } else if (res.failed > 0) {
        toast.error(
          `Import failed — all ${res.failed} row${
            res.failed === 1 ? "" : "s"
          } rejected. See details in the dialog.`
        );
      } else {
        toast.info("Nothing imported — every row was a skipped duplicate.");
      }
    } catch (err) {
      const msg =
        err instanceof ApiProblem
          ? err.problem.detail ?? err.problem.title ?? "Import failed"
          : err instanceof Error
          ? err.message
          : "Import failed.";
      toast.error(msg);
    }
  }

  function handleClose(): void {
    setStep("upload");
    setRows([]);
    setFileName("");
    setParseError(null);
    setSkipDuplicates(false);
    setResult(null);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import Leads from Spreadsheet
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Upload ───────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              {isParsing ? (
                <Loader2 className="h-10 w-10 text-muted-foreground/50 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground/50" />
              )}
              <div className="text-center">
                <p className="text-sm font-medium">
                  {isParsing
                    ? "Parsing…"
                    : "Drop your .csv or .xlsx here, or click to browse"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Expected columns: name, company, email, phone, source,
                  estimatedValue
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  // Reset so picking the same file twice re-triggers onChange
                  e.target.value = "";
                }}
              />
            </div>

            {parseError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{parseError}</span>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <div>
                <p className="text-xs font-medium">Need a template?</p>
                <p className="text-[11px] text-muted-foreground">
                  Download a pre-filled .xlsx with the expected headers.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={downloadTemplate}>
                <Download className="h-3.5 w-3.5 mr-2" />
                Download template
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Preview ──────────────────────────────────────────── */}
        {step === "preview" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">{fileName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-green-700 border-green-200 bg-green-50"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {validRows.length} valid
                </Badge>
                {invalidRows.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-amber-700 border-amber-200 bg-amber-50"
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {invalidRows.length} error{invalidRows.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
            </div>

            {/* Preview table */}
            <div className="border rounded-lg overflow-auto max-h-80">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-12">Row</th>
                    <th className="text-left px-3 py-2 font-medium">Name</th>
                    <th className="text-left px-3 py-2 font-medium">Company</th>
                    <th className="text-left px-3 py-2 font-medium">Email</th>
                    <th className="text-left px-3 py-2 font-medium">Phone</th>
                    <th className="text-left px-3 py-2 font-medium">Source</th>
                    <th className="text-right px-3 py-2 font-medium">Value</th>
                    <th className="px-3 py-2 w-24">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const hasError = row.errors.length > 0;
                    return (
                      <tr
                        key={row.sheetRowNumber}
                        className={`border-t ${
                          hasError ? "bg-red-50/50 dark:bg-red-950/20" : ""
                        }`}
                      >
                        <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                          {row.sheetRowNumber}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.mapped.name ?? (
                            <span className="text-destructive">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.mapped.company ?? (
                            <span className="text-destructive">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.mapped.email ?? (
                            <span className="text-destructive">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.mapped.phone ?? (
                            <span className="text-destructive">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.mapped.source ?? (
                            <span className="text-muted-foreground">
                              Bulk import
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {row.mapped.estimatedValue ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {hasError ? (
                            <span
                              className="inline-flex items-center gap-1 text-destructive"
                              title={row.errors.join(", ")}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span className="text-[11px]">
                                {row.errors[0]}
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-green-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span className="text-[11px]">Ready</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {invalidRows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                ⚠ Rows with errors will be skipped. Fix the file and re-upload
                to include them.
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="skip-duplicates"
                checked={skipDuplicates}
                onCheckedChange={(v) => setSkipDuplicates(Boolean(v))}
              />
              <Label
                htmlFor="skip-duplicates"
                className="text-xs font-normal cursor-pointer"
              >
                Skip rows that match an existing lead&apos;s email or phone
                (default: import them and flag as duplicate)
              </Label>
            </div>
          </div>
        )}

        {/* ── Step 3: Done ─────────────────────────────────────────────── */}
        {step === "done" && result && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-950/40 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold">Import complete</h3>
                <p className="text-xs text-muted-foreground">
                  {result.total} row{result.total === 1 ? "" : "s"} processed
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900/40 p-3">
                <p className="text-[11px] text-green-700 dark:text-green-500 uppercase tracking-wide font-medium">
                  Created
                </p>
                <p className="text-xl font-semibold text-green-800 dark:text-green-300 tabular-nums">
                  {result.created}
                </p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 p-3">
                <p className="text-[11px] text-amber-700 dark:text-amber-500 uppercase tracking-wide font-medium">
                  Duplicates skipped
                </p>
                <p className="text-xl font-semibold text-amber-800 dark:text-amber-300 tabular-nums">
                  {result.duplicatesSkipped}
                </p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40 p-3">
                <p className="text-[11px] text-red-700 dark:text-red-500 uppercase tracking-wide font-medium">
                  Failed
                </p>
                <p className="text-xl font-semibold text-red-800 dark:text-red-300 tabular-nums">
                  {result.failed}
                </p>
              </div>
            </div>

            {result.failed > 0 && (
              <div className="border rounded-lg max-h-48 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium w-16">
                        Row
                      </th>
                      <th className="text-left px-3 py-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows
                      .filter((r) => r.status === "failed")
                      .map((r) => {
                        // Map the API row index back to the spreadsheet row
                        // number so the user can find it in their file.
                        // The API index mirrors validRows ordering.
                        const sheet =
                          validRows[r.index]?.sheetRowNumber ?? r.index + 2;
                        return (
                          <tr key={r.index} className="border-t">
                            <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                              {sheet}
                            </td>
                            <td className="px-3 py-1.5 text-destructive">
                              {r.error ?? "Unknown error"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}
          {step === "preview" && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setRows([]);
                  setFileName("");
                }}
                disabled={bulkCreate.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Re-upload
              </Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0 || bulkCreate.isPending}
              >
                {bulkCreate.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing…
                  </>
                ) : (
                  `Import ${validRows.length} lead${
                    validRows.length === 1 ? "" : "s"
                  }`
                )}
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
