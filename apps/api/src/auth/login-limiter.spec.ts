import { LoginLimiter } from './login-limiter';

describe('LoginLimiter', () => {
  it('blocks after the limit and recovers after the window', () => {
    const l = new LoginLimiter(2, 1000);
    l.recordFailure('a', 0);
    l.recordFailure('a', 10);
    expect(() => l.assertAllowed('a', 20)).toThrow();
    expect(() => l.assertAllowed('a', 5000)).not.toThrow();
  });
  it('reset clears failures', () => {
    const l = new LoginLimiter(1, 1000);
    l.recordFailure('a', 0);
    l.reset('a');
    expect(() => l.assertAllowed('a', 1)).not.toThrow();
  });
});
