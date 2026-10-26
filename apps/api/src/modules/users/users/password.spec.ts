import { verifyLaravelPassword } from '../../../auth/laravel-hash';
import { hashLaravelPassword } from './password';

describe('hashLaravelPassword', () => {
  it('writes a $2y$ bcrypt hash with cost 10 that the login check accepts', async () => {
    const hashed = await hashLaravelPassword('secret-123');
    expect(hashed.startsWith('$2y$10$')).toBe(true);
    expect(hashed).toHaveLength(60);
    expect(await verifyLaravelPassword('secret-123', hashed)).toBe(true);
    expect(await verifyLaravelPassword('wrong', hashed)).toBe(false);
  });
  it('salts every hash', async () => {
    expect(await hashLaravelPassword('same')).not.toBe(await hashLaravelPassword('same'));
  });
});
