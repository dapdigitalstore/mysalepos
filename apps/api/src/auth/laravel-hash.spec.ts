import { hashSync } from 'bcryptjs';
import { verifyLaravelPassword } from './laravel-hash';

describe('verifyLaravelPassword', () => {
  const hash = hashSync('s3cret!', 10);
  const laravelStyle = hash.replace(/^\$2a\$/, '$2y$');

  it('accepts a Laravel ($2y$) hash for the right password', async () => {
    expect(laravelStyle.startsWith('$2y$')).toBe(true);
    await expect(verifyLaravelPassword('s3cret!', laravelStyle)).resolves.toBe(true);
  });
  it('rejects the wrong password', async () => {
    await expect(verifyLaravelPassword('nope', laravelStyle)).resolves.toBe(false);
  });
  it('rejects a non-bcrypt value', async () => {
    await expect(verifyLaravelPassword('x', 'plaintext')).resolves.toBe(false);
  });
});
