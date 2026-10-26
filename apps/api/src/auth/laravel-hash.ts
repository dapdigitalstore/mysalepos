import { compare } from 'bcryptjs';

/**
 * Laravel stores passwords as bcrypt with the `$2y$` prefix. `$2y$` and `$2b$` are the same algorithm
 * as `$2a$`, so existing users keep their passwords.
 */
export function verifyLaravelPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash.startsWith('$2')) return Promise.resolve(false);
  return compare(plain, hash.replace(/^\$2y\$/, '$2a$'));
}

/** Valid bcrypt hash of a random string, used to equalise timing when the username does not exist. */
export const DUMMY_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BUdrBnbS6J2Z5gkbzpqCGLeKD6xS';
