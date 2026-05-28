type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetTimeoutMs: number;

  constructor(opts?: { threshold?: number; resetTimeoutMs?: number }) {
    this.threshold = opts?.threshold ?? 3;
    this.resetTimeoutMs = opts?.resetTimeoutMs ?? 30_000;
  }

  get isOpen(): boolean {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'half_open';
        return false;
      }
      return true;
    }
    return false;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen) {
      throw new CircuitOpenError();
    }

    try {
      const result = await fn();
      if (this.state === 'half_open') {
        this.state = 'closed';
        this.failureCount = 0;
      }
      return result;
    } catch (err) {
      this.failureCount++;
      if (this.failureCount >= this.threshold) {
        this.state = 'open';
        this.lastFailureTime = Date.now();
      }
      throw err;
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
  }
}

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is open');
    this.name = 'CircuitOpenError';
  }
}
