import { hash } from 'bcryptjs';

/**
 * bcrypt hash that Laravel's Hash::check accepts: cost 10 (Laravel's default) and the `$2y$` prefix
 * (`$2a$`, which bcryptjs writes, is the same algorithm).
 */
export async function hashLaravelPassword(plain: string): Promise<string> {
  const hashed = await hash(plain, 10);
  return hashed.replace(/^\$2[ab]\$/, () => '$2y$');
}
