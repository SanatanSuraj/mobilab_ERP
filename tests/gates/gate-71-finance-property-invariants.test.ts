/**
 * Gate 71 — Finance property test: ledger + balance invariants under
 * 10 000 random sequences of invoice / payment / credit-note / advance
 * / refund operations.
 *
 * ─── What this gate proves ──────────────────────────────────────────────
 *
 *   (a) DOUBLE-ENTRY BALANCE
 *       Every journal entry written by an operation must have
 *       sum(debit lines) === sum(credit lines). Globally, across all
 *       entries, sum(debits) === sum(credits). Any operation that
 *       forgets its offsetting leg is a bug.
 *
 *   (b) CUSTOMER BALANCE IDENTITY
 *       For every customer C:
 *
 *           balance(C) == invoices(C) − payments(C) − credits(C)
 *
 *       where:
 *         invoices(C)  = Σ invoice amounts created for C
 *                      + Σ refund amounts paid to C
 *                        (refunds re-add to what the customer owes)
 *         payments(C)  = Σ direct-payment receipts from C
 *                      + Σ advance-receipts from C
 *                        (both reduce what the customer owes — advances
 *                         are just unallocated payments)
 *         credits(C)   = Σ credit-note amounts issued to C
 *         balance(C)   = AR ledger balance(C) − advance-liability(C)
 *                        (net customer position, derived from the
 *                        journal; > 0 means they owe us)
 *
 *       Allocating an advance moves money from ADV_LIABILITY to a
 *       specific invoice via AR; net balance unchanged — which IS the
 *       correctness we want to verify.
 *
 *   (c) NO FLOATING-POINT DRIFT IN API RESPONSES
 *       Every money value emitted by a simulated "API response" snapshot
 *       must match ^-?\d+(\.\d{1,4})?$ (NUMERIC(18,4) column shape).
 *       A value like "10.00000000004" is an immediate property-test
 *       failure — it means someone dropped a Number(...) or parseFloat
 *       into the pipeline.
 *
 * ─── Why pure-model ─────────────────────────────────────────────────────
 *
 * The real finance module is partway built (credit notes deferred to
 * Phase 3, advance allocation partial). A pure TypeScript model of the
 * domain lets us test the ABSTRACT invariants any correct implementation
 * must satisfy — and can later be wired to the real service as a
 * reference oracle. All arithmetic goes through @instigenie/money
 * (decimal.js) so we're exercising the real money primitives.
 *
 * 10 000 runs × ~O(30 ops) = ~300 000 operations. On pure decimal math
 * this finishes in a few seconds well under the 30s vitest timeout.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Decimal, m, moneyToPg, ZERO, type Money } from "@instigenie/money";

// ─── Domain model ──────────────────────────────────────────────────────────

/**
 * Accounts in a minimal chart-of-accounts. AR and ADVANCE_LIABILITY are
 * per-customer; CASH and REVENUE are global. This is enough structure
 * to simulate balanced double-entry on all five operations.
 */
type AccountCode = "CASH" | "AR" | "REVENUE" | "ADVANCE_LIABILITY";

interface JournalLine {
  account: AccountCode;
  customerId: string | null; // required for AR + ADVANCE_LIABILITY
  debit: Money;
  credit: Money;
}

interface JournalEntry {
  seq: number;
  kind: OpKind;
  lines: JournalLine[];
}

interface Invoice {
  id: string;
  customerId: string;
  amount: Money;
  /** Running outstanding after payments / credits / allocations. */
  outstanding: Money;
}

interface Payment {
  id: string;
  customerId: string;
  amount: Money;
  /** null = advance (no invoice targeted); otherwise the invoice.id */
  appliedToInvoiceId: string | null;
  /** Remaining unrefunded portion — refund() decrements this. */
  remaining: Money;
}

interface Advance {
  id: string;
  customerId: string;
  amount: Money;
  /** Unallocated balance — reduced by ALLOCATE_ADVANCE and REFUND. */
  remaining: Money;
}

type OpKind =
  | "INVOICE"
  | "PAYMENT"
  | "CREDIT_NOTE"
  | "ALLOCATE_ADVANCE"
  | "REFUND";

interface CustomerTotals {
  invoicedTotal: Money;
  paidDirectTotal: Money;
  receivedAdvanceTotal: Money;
  creditTotal: Money;
  refundedDirectTotal: Money;
  refundedAdvanceTotal: Money;
}

function zeroTotals(): CustomerTotals {
  return {
    invoicedTotal: ZERO,
    paidDirectTotal: ZERO,
    receivedAdvanceTotal: ZERO,
    creditTotal: ZERO,
    refundedDirectTotal: ZERO,
    refundedAdvanceTotal: ZERO,
  };
}

interface BookState {
  nextSeq: number;
  customers: string[];
  journal: JournalEntry[];
  invoices: Invoice[];
  payments: Payment[];
  advances: Advance[];
  totals: Map<string, CustomerTotals>;
}

function newBook(customers: string[]): BookState {
  const totals = new Map<string, CustomerTotals>();
  for (const c of customers) totals.set(c, zeroTotals());
  return {
    nextSeq: 0,
    customers,
    journal: [],
    invoices: [],
    payments: [],
    advances: [],
    totals,
  };
}

// ─── Operations ────────────────────────────────────────────────────────────

type Op =
  | { kind: "INVOICE"; customerIdx: number; amount: string }
  | {
      kind: "PAYMENT";
      customerIdx: number;
      amount: string;
      /** null ⇒ receipt becomes an advance; otherwise index into book.invoices of the same customer */
      applyToInvoiceIdx: number | null;
    }
  | { kind: "CREDIT_NOTE"; customerIdx: number; amount: string }
  | { kind: "ALLOCATE_ADVANCE"; advanceIdx: number; invoiceIdx: number; amount: string }
  | { kind: "REFUND"; paymentIdx: number; amount: string };

/** Pick the invoice/advance/payment entry, returning null if the index
 * or amount doesn't resolve to a valid target. */
function pickInvoiceForCustomer(
  book: BookState,
  customerId: string,
  rawIdx: number
): Invoice | null {
  const candidates = book.invoices.filter(
    (inv) => inv.customerId === customerId && inv.outstanding.gt(ZERO)
  );
  if (candidates.length === 0) return null;
  return candidates[rawIdx % candidates.length]!;
}

/**
 * Apply an op to the book. Any op whose preconditions fail (no matching
 * invoice, advance exhausted, refund exceeds remaining, etc.) becomes a
 * no-op — that's deliberate: fast-check generates raw indices + amounts,
 * and we skip infeasible ones rather than complicating the arbitrary.
 * Invariants are checked AFTER every step (including no-ops), so skipped
 * ops can't hide bugs.
 */
function apply(book: BookState, op: Op): BookState {
  // Clone top-level to keep each step pure (arrays and the totals map are
  // mutated in place inside the block — they're local to this fn).
  const customers = book.customers;
  switch (op.kind) {
    case "INVOICE": {
      const customerId = customers[op.customerIdx]!;
      const amount = m(op.amount);
      if (amount.lte(ZERO)) return book;
      const id = `inv-${book.invoices.length + 1}`;
      const invoice: Invoice = {
        id,
        customerId,
        amount,
        outstanding: amount,
      };
      const entry: JournalEntry = {
        seq: book.nextSeq,
        kind: "INVOICE",
        lines: [
          { account: "AR", customerId, debit: amount, credit: ZERO },
          { account: "REVENUE", customerId: null, debit: ZERO, credit: amount },
        ],
      };
      const t = bumpTotal(book.totals, customerId, "invoicedTotal", amount);
      return {
        ...book,
        nextSeq: book.nextSeq + 1,
        journal: [...book.journal, entry],
        invoices: [...book.invoices, invoice],
        totals: t,
      };
    }

    case "PAYMENT": {
      const customerId = customers[op.customerIdx]!;
      const amount = m(op.amount);
      if (amount.lte(ZERO)) return book;
      const id = `pay-${book.payments.length + 1}`;
      if (op.applyToInvoiceIdx !== null) {
        // Direct payment — must pick an open invoice for the same customer.
        const invoice = pickInvoiceForCustomer(
          book,
          customerId,
          op.applyToInvoiceIdx
        );
        if (!invoice) {
          // Fall back to "no invoice available": treat as advance.
          return applyAsAdvance(book, id, customerId, amount);
        }
        // Cap at outstanding so we never overpay an invoice. Overage
        // bleeds into a second "leftover" payment tracked as advance so
        // no money is lost.
        const applied = Decimal.min(amount, invoice.outstanding);
        const leftover = amount.minus(applied);

        const nextInvoices = book.invoices.map((inv) =>
          inv.id === invoice.id
            ? { ...inv, outstanding: inv.outstanding.minus(applied) }
            : inv
        );
        const paymentRow: Payment = {
          id,
          customerId,
          amount: applied,
          appliedToInvoiceId: invoice.id,
          remaining: applied,
        };
        const entry: JournalEntry = {
          seq: book.nextSeq,
          kind: "PAYMENT",
          lines: [
            { account: "CASH", customerId: null, debit: applied, credit: ZERO },
            { account: "AR", customerId, debit: ZERO, credit: applied },
          ],
        };
        let totals = bumpTotal(
          book.totals,
          customerId,
          "paidDirectTotal",
          applied
        );

        let payments = [...book.payments, paymentRow];
        let advances = book.advances;
        let journal = [...book.journal, entry];
        let nextSeq = book.nextSeq + 1;

        if (leftover.gt(ZERO)) {
          // Roll the overage into an advance with its own journal entry.
          const advId = `adv-${book.advances.length + 1}`;
          advances = [
            ...advances,
            {
              id: advId,
              customerId,
              amount: leftover,
              remaining: leftover,
            },
          ];
          const advEntry: JournalEntry = {
            seq: nextSeq,
            kind: "PAYMENT",
            lines: [
              {
                account: "CASH",
                customerId: null,
                debit: leftover,
                credit: ZERO,
              },
              {
                account: "ADVANCE_LIABILITY",
                customerId,
                debit: ZERO,
                credit: leftover,
              },
            ],
          };
          journal = [...journal, advEntry];
          nextSeq += 1;
          totals = bumpTotal(
            totals,
            customerId,
            "receivedAdvanceTotal",
            leftover
          );
        }

        return {
          ...book,
          nextSeq,
          journal,
          invoices: nextInvoices,
          payments,
          advances,
          totals,
        };
      }
      // Pure advance — no invoice targeted.
      return applyAsAdvance(book, id, customerId, amount);
    }

    case "CREDIT_NOTE": {
      const customerId = customers[op.customerIdx]!;
      const amount = m(op.amount);
      if (amount.lte(ZERO)) return book;
      const entry: JournalEntry = {
        seq: book.nextSeq,
        kind: "CREDIT_NOTE",
        lines: [
          { account: "REVENUE", customerId: null, debit: amount, credit: ZERO },
          { account: "AR", customerId, debit: ZERO, credit: amount },
        ],
      };
      const totals = bumpTotal(book.totals, customerId, "creditTotal", amount);
      return {
        ...book,
        nextSeq: book.nextSeq + 1,
        journal: [...book.journal, entry],
        totals,
      };
    }

    case "ALLOCATE_ADVANCE": {
      if (book.advances.length === 0 || book.invoices.length === 0) return book;
      const advance = book.advances[op.advanceIdx % book.advances.length]!;
      if (advance.remaining.lte(ZERO)) return book;
      // Must target an invoice of the SAME customer with outstanding > 0.
      const candidates = book.invoices.filter(
        (inv) =>
          inv.customerId === advance.customerId && inv.outstanding.gt(ZERO)
      );
      if (candidates.length === 0) return book;
      const invoice = candidates[op.invoiceIdx % candidates.length]!;

      // Cap by min(advance.remaining, invoice.outstanding, requested).
      const raw = m(op.amount);
      if (raw.lte(ZERO)) return book;
      const applied = Decimal.min(raw, advance.remaining, invoice.outstanding);
      if (applied.lte(ZERO)) return book;

      const entry: JournalEntry = {
        seq: book.nextSeq,
        kind: "ALLOCATE_ADVANCE",
        lines: [
          {
            account: "ADVANCE_LIABILITY",
            customerId: advance.customerId,
            debit: applied,
            credit: ZERO,
          },
          {
            account: "AR",
            customerId: advance.customerId,
            debit: ZERO,
            credit: applied,
          },
        ],
      };

      const invoices = book.invoices.map((inv) =>
        inv.id === invoice.id
          ? { ...inv, outstanding: inv.outstanding.minus(applied) }
          : inv
      );
      const advances = book.advances.map((a) =>
        a.id === advance.id ? { ...a, remaining: a.remaining.minus(applied) } : a
      );

      return {
        ...book,
        nextSeq: book.nextSeq + 1,
        journal: [...book.journal, entry],
        invoices,
        advances,
        // ALLOCATE_ADVANCE is balance-neutral for the customer — it moves
        // money from ADV_LIABILITY to AR and simultaneously reduces
        // invoice outstanding by the same amount. No totals bump.
      };
    }

    case "REFUND": {
      if (book.payments.length === 0 && book.advances.length === 0) return book;
      // Refund targets either a direct payment or an advance (we fold
      // both into one pool for the arbitrary — total length wraps).
      const refundables: (
        | { t: "payment"; row: Payment }
        | { t: "advance"; row: Advance }
      )[] = [
        ...book.payments.map((row) => ({ t: "payment" as const, row })),
        ...book.advances.map((row) => ({ t: "advance" as const, row })),
      ];
      const target = refundables[op.paymentIdx % refundables.length]!;
      const raw = m(op.amount);
      if (raw.lte(ZERO)) return book;

      if (target.t === "payment") {
        const row = target.row;
        if (row.remaining.lte(ZERO)) return book;
        const applied = Decimal.min(raw, row.remaining);
        if (applied.lte(ZERO)) return book;
        // Reversing a direct payment: CR cash, DR AR (customer owes again).
        const entry: JournalEntry = {
          seq: book.nextSeq,
          kind: "REFUND",
          lines: [
            {
              account: "AR",
              customerId: row.customerId,
              debit: applied,
              credit: ZERO,
            },
            {
              account: "CASH",
              customerId: null,
              debit: ZERO,
              credit: applied,
            },
          ],
        };
        const payments = book.payments.map((p) =>
          p.id === row.id ? { ...p, remaining: p.remaining.minus(applied) } : p
        );
        const totals = bumpTotal(
          book.totals,
          row.customerId,
          "refundedDirectTotal",
          applied
        );
        return {
          ...book,
          nextSeq: book.nextSeq + 1,
          journal: [...book.journal, entry],
          payments,
          totals,
        };
      }
      // Advance refund.
      const adv = target.row;
      if (adv.remaining.lte(ZERO)) return book;
      const applied = Decimal.min(raw, adv.remaining);
      if (applied.lte(ZERO)) return book;
      const entry: JournalEntry = {
        seq: book.nextSeq,
        kind: "REFUND",
        lines: [
          {
            account: "ADVANCE_LIABILITY",
            customerId: adv.customerId,
            debit: applied,
            credit: ZERO,
          },
          { account: "CASH", customerId: null, debit: ZERO, credit: applied },
        ],
      };
      const advances = book.advances.map((a) =>
        a.id === adv.id ? { ...a, remaining: a.remaining.minus(applied) } : a
      );
      const totals = bumpTotal(
        book.totals,
        adv.customerId,
        "refundedAdvanceTotal",
        applied
      );
      return {
        ...book,
        nextSeq: book.nextSeq + 1,
        journal: [...book.journal, entry],
        advances,
        totals,
      };
    }
  }
}

function applyAsAdvance(
  book: BookState,
  id: string,
  customerId: string,
  amount: Money
): BookState {
  const entry: JournalEntry = {
    seq: book.nextSeq,
    kind: "PAYMENT",
    lines: [
      { account: "CASH", customerId: null, debit: amount, credit: ZERO },
      {
        account: "ADVANCE_LIABILITY",
        customerId,
        debit: ZERO,
        credit: amount,
      },
    ],
  };
  const advId = `adv-${book.advances.length + 1}`;
  const advances = [
    ...book.advances,
    { id: advId, customerId, amount, remaining: amount },
  ];
  const payments = [
    ...book.payments,
    {
      id,
      customerId,
      amount,
      appliedToInvoiceId: null,
      remaining: ZERO, // pure advance — refund goes through the advance row, not the payment row
    },
  ];
  const totals = bumpTotal(
    book.totals,
    customerId,
    "receivedAdvanceTotal",
    amount
  );
  return {
    ...book,
    nextSeq: book.nextSeq + 1,
    journal: [...book.journal, entry],
    payments,
    advances,
    totals,
  };
}

function bumpTotal(
  totals: Map<string, CustomerTotals>,
  customerId: string,
  field: keyof CustomerTotals,
  delta: Money
): Map<string, CustomerTotals> {
  const next = new Map(totals);
  const cur = next.get(customerId) ?? zeroTotals();
  next.set(customerId, { ...cur, [field]: cur[field].plus(delta) });
  return next;
}

// ─── Invariants ────────────────────────────────────────────────────────────

/** Invariant (a), per-entry: each journal entry's DRs and CRs net to zero. */
function assertPerEntryBalanced(entry: JournalEntry): void {
  const dr = entry.lines.reduce<Money>((acc, l) => acc.plus(l.debit), ZERO);
  const cr = entry.lines.reduce<Money>((acc, l) => acc.plus(l.credit), ZERO);
  if (!dr.eq(cr)) {
    throw new Error(
      `journal entry ${entry.seq} (${entry.kind}) unbalanced: ` +
        `DR=${moneyToPg(dr)} CR=${moneyToPg(cr)}`
    );
  }
}

/** Invariant (a), global: across all entries, ΣDR === ΣCR. */
function assertGlobalBalanced(book: BookState): void {
  let dr = ZERO;
  let cr = ZERO;
  for (const e of book.journal) {
    for (const l of e.lines) {
      dr = dr.plus(l.debit);
      cr = cr.plus(l.credit);
    }
  }
  if (!dr.eq(cr)) {
    throw new Error(
      `global journal unbalanced: ΣDR=${moneyToPg(dr)} ΣCR=${moneyToPg(cr)}`
    );
  }
}

/** Derive customer balance from the journal (net AR − ADV_LIABILITY). */
function deriveBalance(book: BookState, customerId: string): Money {
  let balance = ZERO;
  for (const e of book.journal) {
    for (const l of e.lines) {
      if (l.customerId !== customerId) continue;
      if (l.account === "AR") {
        balance = balance.plus(l.debit).minus(l.credit);
      } else if (l.account === "ADVANCE_LIABILITY") {
        // ADV_LIABILITY is a liability → credit-normal. Net customer
        // position subtracts it.
        balance = balance.minus(l.credit).plus(l.debit);
      }
    }
  }
  return balance;
}

/**
 * Invariant (b): for each customer,
 *   balance == (invoices + refundsDirect + refundsAdvance)
 *              − (paidDirect + receivedAdvance)
 *              − credits
 *
 * Expressed in the user's short form "invoices − payments − credits":
 *   invoices  = invoiced + refundedDirect + refundedAdvance  (anything that re-adds to what they owe)
 *   payments  = paidDirect + receivedAdvance                 (money received from them)
 *   credits   = creditNotes                                   (write-offs)
 */
function assertBalanceIdentity(book: BookState): void {
  for (const c of book.customers) {
    const t = book.totals.get(c) ?? zeroTotals();
    const invoices = t.invoicedTotal
      .plus(t.refundedDirectTotal)
      .plus(t.refundedAdvanceTotal);
    const payments = t.paidDirectTotal.plus(t.receivedAdvanceTotal);
    const credits = t.creditTotal;
    const expected = invoices.minus(payments).minus(credits);
    const actual = deriveBalance(book, c);
    if (!actual.eq(expected)) {
      throw new Error(
        `customer ${c} balance identity broken: ` +
          `expected ${moneyToPg(expected)} (${moneyToPg(invoices)} − ${moneyToPg(
            payments
          )} − ${moneyToPg(credits)}), got ${moneyToPg(actual)} from journal`
      );
    }
  }
}

// ─── (c) Floating-point drift scanner ──────────────────────────────────────

// Money strings on the wire must look like NUMERIC(18,4): up to 4 fractional
// digits, optional leading minus. A value like "10.00000000004" blows this.
const MONEY_RE = /^-?\d+(\.\d{1,4})?$/u;

/** Keys that carry money values in a simulated API response snapshot.
 * Anything else (ids, counts, kind, etc.) is skipped by the scanner. */
const MONEY_KEYS = new Set<string>([
  "amount",
  "balance",
  "outstanding",
  "remaining",
  "debit",
  "credit",
  "invoicedTotal",
  "paidDirectTotal",
  "receivedAdvanceTotal",
  "creditTotal",
  "refundedDirectTotal",
  "refundedAdvanceTotal",
  "expected",
  "actual",
]);

/**
 * Project the book to a JSON-safe snapshot ("API response"). Every money
 * value is serialised via moneyToPg (Decimal → string). We then walk the
 * JSON and validate every money field's shape.
 */
interface ApiSnapshot {
  customers: {
    customerId: string;
    balance: string;
    invoicedTotal: string;
    paidDirectTotal: string;
    receivedAdvanceTotal: string;
    creditTotal: string;
    refundedDirectTotal: string;
    refundedAdvanceTotal: string;
  }[];
  invoices: {
    id: string;
    customerId: string;
    amount: string;
    outstanding: string;
  }[];
  payments: {
    id: string;
    customerId: string;
    amount: string;
    remaining: string;
  }[];
  advances: {
    id: string;
    customerId: string;
    amount: string;
    remaining: string;
  }[];
  journal: {
    seq: number;
    kind: string;
    lines: {
      account: string;
      customerId: string | null;
      debit: string;
      credit: string;
    }[];
  }[];
}

function snapshot(book: BookState): ApiSnapshot {
  return {
    customers: book.customers.map((c) => {
      const t = book.totals.get(c) ?? zeroTotals();
      return {
        customerId: c,
        balance: moneyToPg(deriveBalance(book, c)),
        invoicedTotal: moneyToPg(t.invoicedTotal),
        paidDirectTotal: moneyToPg(t.paidDirectTotal),
        receivedAdvanceTotal: moneyToPg(t.receivedAdvanceTotal),
        creditTotal: moneyToPg(t.creditTotal),
        refundedDirectTotal: moneyToPg(t.refundedDirectTotal),
        refundedAdvanceTotal: moneyToPg(t.refundedAdvanceTotal),
      };
    }),
    invoices: book.invoices.map((i) => ({
      id: i.id,
      customerId: i.customerId,
      amount: moneyToPg(i.amount),
      outstanding: moneyToPg(i.outstanding),
    })),
    payments: book.payments.map((p) => ({
      id: p.id,
      customerId: p.customerId,
      amount: moneyToPg(p.amount),
      remaining: moneyToPg(p.remaining),
    })),
    advances: book.advances.map((a) => ({
      id: a.id,
      customerId: a.customerId,
      amount: moneyToPg(a.amount),
      remaining: moneyToPg(a.remaining),
    })),
    journal: book.journal.map((e) => ({
      seq: e.seq,
      kind: e.kind,
      lines: e.lines.map((l) => ({
        account: l.account,
        customerId: l.customerId,
        debit: moneyToPg(l.debit),
        credit: moneyToPg(l.credit),
      })),
    })),
  };
}

/**
 * Walk any JSON-ish value; when we land on a money-keyed string, enforce
 * MONEY_RE. Non-money strings and numbers are ignored. We also FAIL if any
 * money-keyed value is a `number` rather than a string — in a properly
 * typed pipeline money is ALWAYS a decimal string; a number in that slot
 * is a regression marker.
 */
function assertNoFloatDrift(
  value: unknown,
  path = "$",
  parentKey: string | null = null
): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoFloatDrift(v, `${path}[${i}]`, parentKey));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNoFloatDrift(v, `${path}.${k}`, k);
    }
    return;
  }
  // Leaf. Only check money-keyed leaves.
  if (parentKey === null || !MONEY_KEYS.has(parentKey)) return;
  if (typeof value === "number") {
    throw new Error(
      `float-drift: ${path} carries a JS number (${value}); money must be a decimal string`
    );
  }
  if (typeof value !== "string") {
    throw new Error(
      `float-drift: ${path} carries a non-string money value (${typeof value})`
    );
  }
  if (!MONEY_RE.test(value)) {
    throw new Error(
      `float-drift: ${path} = "${value}" — fails NUMERIC(18,4) shape /^-?\\d+(\\.\\d{1,4})?$/`
    );
  }
}

// ─── fast-check arbitraries ────────────────────────────────────────────────

/**
 * Money amount arbitrary. Bounded to ≤4 fractional digits to match the
 * NUMERIC(18,4) column scale: generating more precision than the schema
 * can round-trip would spuriously trip invariant (c).
 */
const moneyArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 0, max: 1_000_000 }), // whole rupees
    fc.integer({ min: 0, max: 9999 }) // paise (4 decimals)
  )
  .map(([whole, frac]) => {
    const fracStr = String(frac).padStart(4, "0");
    // Drop trailing zeros but keep ≥1 integer digit.
    const raw = `${whole}.${fracStr}`.replace(/\.?0+$/, "");
    return raw === "" ? "0" : raw;
  })
  .filter((s) => m(s).gt(ZERO)); // reject zero so every op has material effect

const CUSTOMER_POOL = ["c-alpha", "c-beta", "c-gamma", "c-delta"];

const opArb: fc.Arbitrary<Op> = fc.oneof(
  // INVOICE
  fc.record({
    kind: fc.constant("INVOICE" as const),
    customerIdx: fc.integer({ min: 0, max: CUSTOMER_POOL.length - 1 }),
    amount: moneyArb,
  }),
  // PAYMENT (direct or advance)
  fc.record({
    kind: fc.constant("PAYMENT" as const),
    customerIdx: fc.integer({ min: 0, max: CUSTOMER_POOL.length - 1 }),
    amount: moneyArb,
    applyToInvoiceIdx: fc.oneof(
      fc.constant(null),
      fc.integer({ min: 0, max: 63 })
    ),
  }),
  // CREDIT_NOTE
  fc.record({
    kind: fc.constant("CREDIT_NOTE" as const),
    customerIdx: fc.integer({ min: 0, max: CUSTOMER_POOL.length - 1 }),
    amount: moneyArb,
  }),
  // ALLOCATE_ADVANCE
  fc.record({
    kind: fc.constant("ALLOCATE_ADVANCE" as const),
    advanceIdx: fc.integer({ min: 0, max: 63 }),
    invoiceIdx: fc.integer({ min: 0, max: 63 }),
    amount: moneyArb,
  }),
  // REFUND
  fc.record({
    kind: fc.constant("REFUND" as const),
    paymentIdx: fc.integer({ min: 0, max: 127 }),
    amount: moneyArb,
  })
);

const sequenceArb = fc.array(opArb, { minLength: 1, maxLength: 40 });

// ─── The property test ────────────────────────────────────────────────────

describe("gate-71: finance invariants hold over 10 000 random operation sequences", () => {
  it("per-entry balance, global balance, customer identity, no float drift", () => {
    fc.assert(
      fc.property(sequenceArb, (ops) => {
        let book = newBook(CUSTOMER_POOL);
        for (const op of ops) {
          const before = book.journal.length;
          book = apply(book, op);
          const after = book.journal.length;

          // (a) per-entry: any new entry must be internally balanced.
          for (let i = before; i < after; i++) {
            assertPerEntryBalanced(book.journal[i]!);
          }
          // (a) global: running totals stay balanced.
          assertGlobalBalanced(book);
          // (b) customer balance identity.
          assertBalanceIdentity(book);
          // (c) API response has no float drift.
          assertNoFloatDrift(snapshot(book));
        }
        return true;
      }),
      { numRuns: 10_000, verbose: false }
    );
  }, 60_000);

  // ── Negative control: prove the drift detector actually catches drift.
  //    If someone deletes MONEY_RE or weakens it, this test breaks loudly.
  it("drift detector rejects a 0.1+0.2 float-drift string", () => {
    const drifted = (0.1 + 0.2).toString(); // "0.30000000000000004"
    expect(() =>
      assertNoFloatDrift({ balance: drifted }, "$.negative", null)
      // ^ parentKey starts null; the recursion will key it as "balance"
    ).toThrow(/float-drift/);
  });

  it("drift detector rejects a number in a money slot", () => {
    expect(() => assertNoFloatDrift({ amount: 10.5 })).toThrow(
      /carries a JS number/
    );
  });

  // ── Sanity: a single hand-crafted sequence should produce the expected
  //    customer balance. Keeps the model honest independently of the
  //    property test (which only asserts invariants, not specific values).
  it("hand-crafted sequence produces the textbook balance", () => {
    let book = newBook(["only-one"]);
    // Invoice 1000 → balance = 1000
    book = apply(book, {
      kind: "INVOICE",
      customerIdx: 0,
      amount: "1000",
    });
    // Pay 400 direct → balance = 600
    book = apply(book, {
      kind: "PAYMENT",
      customerIdx: 0,
      amount: "400",
      applyToInvoiceIdx: 0,
    });
    // Credit note 100 → balance = 500
    book = apply(book, {
      kind: "CREDIT_NOTE",
      customerIdx: 0,
      amount: "100",
    });
    // Receive advance 200 → balance = 300 (they prepaid 200)
    book = apply(book, {
      kind: "PAYMENT",
      customerIdx: 0,
      amount: "200",
      applyToInvoiceIdx: null,
    });
    // Allocate 150 of advance to invoice 0 → balance unchanged = 300
    book = apply(book, {
      kind: "ALLOCATE_ADVANCE",
      advanceIdx: 0,
      invoiceIdx: 0,
      amount: "150",
    });
    // Refund 50 of the direct payment → balance = 350
    book = apply(book, {
      kind: "REFUND",
      paymentIdx: 0,
      amount: "50",
    });
    const balance = deriveBalance(book, "only-one");
    expect(moneyToPg(balance)).toBe("350");
    // Every invariant still holds.
    assertGlobalBalanced(book);
    assertBalanceIdentity(book);
    assertNoFloatDrift(snapshot(book));
  });
});
