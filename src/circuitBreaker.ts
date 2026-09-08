/** @format */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Consecutive failures required to open the circuit. Default: 5 */
  failureThreshold?: number;
  /** How long the circuit stays open before allowing a trial request. Default: 30000ms */
  cooldownMs?: number;
}

/**
 * Tracks consecutive failures for a RetryManager and trips to "open" once a
 * threshold is hit, so callers fail fast instead of retrying against a
 * service that's fully down. After the cooldown, one trial request is let
 * through ("half-open"); it closes the circuit on success or reopens it on
 * failure.
 *
 * This is a simple, single-process, per-manager breaker — it doesn't
 * coordinate across concurrent trial requests during "half-open" (more than
 * one caller can end up probing at once), and it isn't shared across
 * separate RetryManager instances even if they target the same endpoint.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.cooldownMs = config.cooldownMs ?? 30000;
  }

  canAttempt(): boolean {
    if (this.state !== 'open') {
      return true;
    }

    if (Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
      return true;
    }

    return false;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.consecutiveFailures++;

    if (this.state === 'half-open' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
