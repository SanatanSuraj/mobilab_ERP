/**
 * Event Bus — outbox pattern stub
 *
 * Architecture doc ERP-ARCH-MIDSCALE-2025-005 §5.2:
 *   deal.won          < 5s   → triggers WO creation, inventory reservation
 *   grn.created       < 5s   → triggers QC inward inspection workflow
 *   qc_inward.passed  < 3s   → releases stock from quarantine
 *   qc_inward.failed  < 3s   → triggers RTV workflow
 *   invoice.created   < 5s   → updates customer ledger
 *
 * Today (mock): events are logged to console and stored in a local queue.
 *   Listeners can subscribe client-side for optimistic UI updates.
 *
 * Tomorrow (real): replace emit() body with:
 *   POST /api/events { type, payload, orgId }
 *   The server writes to the `outbox` table (transactional outbox pattern).
 *   Celery worker picks up via LISTEN/NOTIFY and dispatches to consumers.
 *
 * SSE streaming (real):
 *   useEventStream() hook opens EventSource('/api/events/stream')
 *   Server pushes events as they are processed.
 *   Replace useEventStream stub below with real implementation.
 *
 * Usage:
 *   import { eventBus } from "@/lib/events";
 *   eventBus.emit("deal.won", { dealId, orgId });
 *   eventBus.on("deal.won", (payload) => { ... });
 */

import { useEffect } from "react";

// ─── Event Catalogue ─────────────────────────────────────────────────────────

export type ErpEventType =
  | "deal.won"
  | "deal.lost"
  | "grn.created"
  | "qc_inward.passed"
  | "qc_inward.failed"
  | "invoice.created"
  | "work_order.created"
  | "work_order.completed"
  | "stock.adjusted"
  | "payment.received";

export interface ErpEvent<T = unknown> {
  type: ErpEventType;
  orgId: string;
  payload: T;
  emittedAt: string; // ISO timestamp
}

// ─── In-Memory Bus ─────────────────────────────────────────────────────────

type Listener<T = unknown> = (event: ErpEvent<T>) => void;

class EventBus {
  private listeners = new Map<ErpEventType, Set<Listener>>();
  private queue: ErpEvent[] = []; // retained for debugging

  on<T>(type: ErpEventType, listener: Listener<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener as Listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(type)?.delete(listener as Listener);
    };
  }

  emit<T>(type: ErpEventType, orgId: string, payload: T): void {
    const event: ErpEvent<T> = {
      type,
      orgId,
      payload,
      emittedAt: new Date().toISOString(),
    };

    // ── MOCK: log to console in development ──────────────────────────────
    if (process.env.NODE_ENV === "development") {
      console.debug("[EventBus] %s", type, payload);
    }
    // ── TODO: POST to /api/events in production ──────────────────────────
    // apiFetch("/api/events", { method: "POST", body: JSON.stringify(event) });

    this.queue.push(event as ErpEvent);
    this.listeners.get(type)?.forEach((l) => l(event as ErpEvent));
  }

  /** Drain the queue — useful for testing / debugging. */
  flushQueue(): ErpEvent[] {
    const drained = [...this.queue];
    this.queue = [];
    return drained;
  }
}

/** Singleton bus — import from anywhere. */
export const eventBus = new EventBus();

// ─── React Hook ──────────────────────────────────────────────────────────────

/**
 * Subscribe to an ERP event inside a React component.
 * Automatically unsubscribes on unmount.
 *
 * @example
 * useErpEvent("deal.won", ({ payload }) => {
 *   toast.success(`Deal ${payload.dealId} won — creating work order…`);
 *   queryClient.invalidateQueries({ queryKey: crmKeys.deals() });
 * });
 */
export function useErpEvent<T>(
  type: ErpEventType,
  handler: (event: ErpEvent<T>) => void
): void {
  useEffect(() => {
    return eventBus.on<T>(type, handler);
    // handler is intentionally excluded from deps — callers must memoize it
    // if they need stability, or accept re-subscription each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
}

// ─── SSE Hook Stub ────────────────────────────────────────────────────────────

/**
 * useEventStream — real-time server push stub.
 *
 * Today: no-op.
 * Tomorrow: open EventSource('/api/events/stream?orgId=...') and dispatch
 *   received events into eventBus.emit() so all useErpEvent() subscribers
 *   receive server-initiated events.
 *
 * @example
 * // In your root layout or dashboard shell:
 * useEventStream(); // opens SSE connection once
 */
export function useEventStream(): void {
  useEffect(() => {
    // TODO: replace with real SSE when backend is ready
    // const source = new EventSource('/api/events/stream');
    // source.onmessage = (e) => {
    //   const event = JSON.parse(e.data) as ErpEvent;
    //   eventBus.emit(event.type, event.orgId, event.payload);
    // };
    // return () => source.close();
  }, []);
}
