/** @format */

import { CircuitBreaker } from '../src/circuitBreaker';

describe('CircuitBreaker', () => {
  it('starts closed and allows attempts', () => {
    const breaker = new CircuitBreaker();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('stays closed while failures remain under the threshold', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.getState()).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('opens once consecutive failures reach the threshold', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.getState()).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('a success resets the failure count and closes the circuit', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.getState()).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('moves to half-open and allows a trial request once the cooldown elapses', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 20 });

    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');
    expect(breaker.canAttempt()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.getState()).toBe('half-open');
  });

  it('closes the circuit when the half-open trial succeeds', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 20 });

    breaker.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 30));
    breaker.canAttempt();

    breaker.recordSuccess();

    expect(breaker.getState()).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('reopens the circuit when the half-open trial fails', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 20 });

    breaker.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 30));
    breaker.canAttempt();

    breaker.recordFailure();

    expect(breaker.getState()).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
  });
});
