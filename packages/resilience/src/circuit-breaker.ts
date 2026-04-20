/**
 * Three-state circuit breaker. ARCHITECTURE.md §6.
 *
 * States:
 *   CLOSED    — normal. Track failures; if rate > threshold in window → OPEN.
 *   OPEN      — short-circuit. Throw DependencyUnavailableError immediately.
 *               After cooldown, move to HALF_OPEN and let one probe through.
 *   HALF_OPEN — probing. If the probe succeeds → CLOSED. If it fails → OPEN,
 *               reset the cooldown timer.
 *
 * Use one breaker per downstream dependency (SMS, e-invoice, payment
 * webhook, etc.) — don't share across unrelated services.
 */

import { DependencyUnavailableError } from "@mobilab/errors";

type State = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface BreakerOptions {
  /** Human-readable name for logs / errors, e.g. "sms-gateway". */
  name: string;
  /** Failures allowed before tripping. Default 5. */
  failureThreshold?: number;
  /** Rolling window for counting failures (ms). Default 60_000. */
  windowMs?: number;
  /** How long to stay OPEN before trying a HALF_OPEN probe (ms). Default 30_000. */
  cooldownMs?: number;
  /** Optional hook when the state changes. */
  onStateChange?: (prev: State, next: State) => void;
}

export class CircuitBreaker {
  private state: State = "CLOSED";
  private failures: number[] = []; // timestamps
  private openedAt = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly onStateChange?: (prev: State, next: State) => void;

  constructor(opts: BreakerOptions) {
    this.name = opts.name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.windowMs = opts.windowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.onStateChange = opts.onStateChange;
  }

  getState(): State {
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.transitionTo("HALF_OPEN");
      } else {
        throw new DependencyUnavailableError(
          `${this.name}: circuit open`,
          { breaker: this.name, state: this.state }
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.failures = [];
      this.transitionTo("CLOSED");
    } else if (this.state === "CLOSED") {
      this.pruneWindow();
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.pruneWindow();

    if (this.state === "HALF_OPEN") {
      this.openedAt = now;
      this.transitionTo("OPEN");
      return;
    }
    if (this.state === "CLOSED" && this.failures.length >= this.failureThreshold) {
      this.openedAt = now;
      this.transitionTo("OPEN");
    }
  }

  private pruneWindow(): void {
    const cutoff = Date.now() - this.windowMs;
    this.failures = this.failures.filter((t) => t >= cutoff);
  }

  private transitionTo(next: State): void {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    this.onStateChange?.(prev, next);
  }
}
