import { HttpException, HttpStatus } from '@nestjs/common';

/** In-memory throttle: max `limit` failed logins per key inside `windowMs`. */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly limit = 5, private readonly windowMs = 15 * 60_000) {}

  assertAllowed(key: string, now = Date.now()) {
    if (this.recent(key, now).length >= this.limit) {
      throw new HttpException('Too many failed login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  recordFailure(key: string, now = Date.now()) {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  reset(key: string) {
    this.failures.delete(key);
  }

  private recent(key: string, now: number) {
    return (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }
}
