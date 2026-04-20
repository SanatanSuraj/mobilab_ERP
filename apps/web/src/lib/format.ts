/**
 * Single source of truth for all formatting utilities.
 * Import from HERE — never from data/*.ts files.
 *
 * When i18n lands: swap `locale` to user preference from store.
 */

const INR_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATETIME_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Formats a number as Indian Rupee currency.
 * @example formatCurrency(285000) → "₹2,85,000"
 */
export function formatCurrency(amount: number): string {
  return INR_FORMATTER.format(amount);
}

/**
 * Formats a decimal-string amount (NUMERIC wire shape) as INR. The real
 * CRM contracts ship money as strings like "12345.67" — never as numbers —
 * so this is the formatter to use for Lead.estimatedValue, Deal.value,
 * Account.annualRevenue, etc.
 *
 * We still pass the parsed number to Intl because `Intl.NumberFormat` only
 * accepts numbers/bigints. Decimal strings that represent integers or
 * typical INR amounts (up to ~10¹³) round-trip safely through `Number()`;
 * for anything approaching MAX_SAFE_INTEGER we'd need a decimal library,
 * but that is overkill for UI display.
 *
 * @example formatCurrencyStr("285000") → "₹2,85,000"
 * @example formatCurrencyStr("285000.75") → "₹2,85,001" (rounded)
 */
export function formatCurrencyStr(amount: string | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return INR_FORMATTER.format(n);
}

/**
 * Formats a date string or Date object.
 * @example formatDate("2026-04-18") → "18 Apr 2026"
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return DATE_FORMATTER.format(d);
}

/**
 * Formats a date string or Date object with time.
 * @example formatDateTime("2026-04-18T14:30:00") → "18 Apr 2026, 02:30 pm"
 */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return DATETIME_FORMATTER.format(d);
}

/**
 * Returns "X days ago", "Today", "Yesterday", etc.
 */
export function formatRelativeDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return formatDate(d);
}

/**
 * Returns number of calendar days between two dates.
 * Negative = future, Positive = past.
 */
export function daysDiff(from: string | Date, to: string | Date = new Date()): number {
  const a = typeof from === "string" ? new Date(from) : from;
  const b = typeof to === "string" ? new Date(to) : to;
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns true if the given date string is before today.
 */
export function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date(new Date().toDateString());
}

/**
 * Returns the current month as "YYYY-MM" prefix for filtering.
 * @example currentMonthPrefix() → "2026-04"
 */
export function currentMonthPrefix(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
