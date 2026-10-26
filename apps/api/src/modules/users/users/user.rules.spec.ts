import {
  applyUsernameSuffix,
  assertCanManageTarget,
  assertSelfEditSafe,
  assertLocationsValid,
  assertRoleAssignable,
  assertRoleChangeAllowed,
  assertUserDeletable,
  cleanCommissionPercent,
  cleanMaxDiscountPercent,
  cleanUsername,
  formatDob,
  fullName,
  isTruthySetting,
  locationAccessOf,
  parseBankDetails,
  parseDob,
  planLocationPermissions,
  planLogin,
  serializeBankDetails,
  usernameSuffix,
  validatePassword,
} from './user.rules';

describe('fullName', () => {
  it('joins the parts that are filled in', () => {
    expect(fullName({ surname: 'Mr', first_name: 'Nimal', last_name: 'Perera' })).toBe('Mr Nimal Perera');
    expect(fullName({ surname: null, first_name: 'Kamal', last_name: null })).toBe('Kamal');
    expect(fullName({ surname: ' ', first_name: ' Ann ', last_name: '' })).toBe('Ann');
  });
});

describe('username suffix', () => {
  it('follows the enable_business_based_username setting', () => {
    expect(usernameSuffix(7, true)).toBe('-07');
    expect(usernameSuffix(12, true)).toBe('-12');
    expect(usernameSuffix(7, false)).toBe('');
  });
  it('reads the system property like PHP empty()', () => {
    expect(isTruthySetting('1')).toBe(true);
    expect(isTruthySetting('0')).toBe(false);
    expect(isTruthySetting('')).toBe(false);
    expect(isTruthySetting(null)).toBe(false);
  });
  it('never appends the suffix twice', () => {
    expect(applyUsernameSuffix('cashier', '-07')).toBe('cashier-07');
    expect(applyUsernameSuffix('cashier-07', '-07')).toBe('cashier-07');
    expect(applyUsernameSuffix('cashier', '')).toBe('cashier');
  });
});

describe('credentials', () => {
  it('needs 5 characters for password and username', () => {
    expect(() => validatePassword('abcd')).toThrow();
    expect(validatePassword('abcde')).toBe('abcde');
    expect(() => cleanUsername('abcd')).toThrow();
    expect(cleanUsername('  abcde ')).toBe('abcde');
  });
  it('rejects spaces in usernames and passwords longer than bcrypt reads', () => {
    expect(() => cleanUsername('ab cde')).toThrow();
    expect(() => validatePassword('x'.repeat(73))).toThrow();
    expect(validatePassword('x'.repeat(72))).toHaveLength(72);
  });
});

describe('planLogin', () => {
  const base = { suffix: '-07', isNew: true, hasPassword: false };
  it('clears username and password when login is not allowed', () => {
    expect(planLogin({ allowLogin: false, username: 'someone', password: 'secret1' }, base)).toEqual({ allowLogin: false });
  });
  it('requires a password for a new login', () => {
    expect(() => planLogin({ allowLogin: true, username: 'cashier' }, base)).toThrow(/Password is required/);
  });
  it('adds the business suffix to a typed username', () => {
    expect(planLogin({ allowLogin: true, username: 'cashier', password: 'secret1' }, base)).toEqual({
      allowLogin: true,
      username: 'cashier-07',
      password: 'secret1',
    });
  });
  it('asks for a generated username when none was typed', () => {
    expect(planLogin({ allowLogin: true, password: 'secret1' }, base)).toEqual({ allowLogin: true, username: null, password: 'secret1' });
  });
  it('keeps the password and username of an existing user when they are not changed', () => {
    const edit = { suffix: '-07', isNew: false, hasPassword: true, existingUsername: 'cashier-07' };
    expect(planLogin({ allowLogin: true, username: '', password: '' }, edit)).toEqual({ allowLogin: true, username: 'cashier-07', password: null });
  });
  it('requires a password when login is switched on for a user that never had one', () => {
    const edit = { suffix: '', isNew: false, hasPassword: false, existingUsername: null };
    expect(() => planLogin({ allowLogin: true }, edit)).toThrow();
  });
  it('validates a changed username and password', () => {
    const edit = { suffix: '', isNew: false, hasPassword: true, existingUsername: 'olduser' };
    expect(() => planLogin({ allowLogin: true, username: 'abc' }, edit)).toThrow();
    expect(() => planLogin({ allowLogin: true, password: 'abc' }, edit)).toThrow();
  });
});

describe('percentages', () => {
  it('stores the commission with two decimals', () => {
    expect(cleanCommissionPercent(undefined)).toBe('0.00');
    expect(cleanCommissionPercent(2.5)).toBe('2.50');
    expect(cleanCommissionPercent(99.99)).toBe('99.99');
  });
  it('rejects a commission the column cannot hold', () => {
    expect(() => cleanCommissionPercent(100)).toThrow();
    expect(() => cleanCommissionPercent(-1)).toThrow();
    expect(() => cleanCommissionPercent(1.005)).toThrow();
    expect(() => cleanCommissionPercent(Number.NaN)).toThrow();
  });
  it('allows no limit or a limit up to 100 percent for the sales discount', () => {
    expect(cleanMaxDiscountPercent(null)).toBeNull();
    expect(cleanMaxDiscountPercent(undefined)).toBeNull();
    expect(cleanMaxDiscountPercent(0)).toBe('0.00');
    expect(cleanMaxDiscountPercent(100)).toBe('100.00');
    expect(() => cleanMaxDiscountPercent(100.01)).toThrow();
    expect(() => cleanMaxDiscountPercent(-5)).toThrow();
  });
});

describe('deleting users', () => {
  const base = { actorId: 1, targetId: 2, targetIsAdmin: false, adminCount: 2 };
  it('lets an admin delete another user', () => {
    expect(() => assertUserDeletable(base)).not.toThrow();
  });
  it('never lets a user delete themselves', () => {
    expect(() => assertUserDeletable({ ...base, targetId: 1 })).toThrow(/own account/);
  });
  it('protects the last admin', () => {
    expect(() => assertUserDeletable({ ...base, targetIsAdmin: true, adminCount: 1 })).toThrow(/only admin/);
    expect(() => assertUserDeletable({ ...base, targetIsAdmin: true, adminCount: 2 })).not.toThrow();
  });
});

describe('changing roles', () => {
  it('keeps the last admin in the Admin role', () => {
    expect(() => assertRoleChangeAllowed({ previousRoleId: 1, newRoleId: 2, targetIsAdmin: true, adminCount: 1 })).toThrow();
  });
  it('allows the change when there is another admin or the role stays the same', () => {
    expect(() => assertRoleChangeAllowed({ previousRoleId: 1, newRoleId: 2, targetIsAdmin: true, adminCount: 2 })).not.toThrow();
    expect(() => assertRoleChangeAllowed({ previousRoleId: 1, newRoleId: 1, targetIsAdmin: true, adminCount: 1 })).not.toThrow();
    expect(() => assertRoleChangeAllowed({ previousRoleId: 5, newRoleId: 6, targetIsAdmin: false, adminCount: 1 })).not.toThrow();
  });
  it('lets only admins assign the Admin role', () => {
    expect(() => assertRoleAssignable({ name: 'Admin#3' }, 3, false)).toThrow();
    expect(() => assertRoleAssignable({ name: 'Admin#3' }, 3, true)).not.toThrow();
    expect(() => assertRoleAssignable({ name: 'Cashier#3' }, 3, false)).not.toThrow();
  });
});

describe('bank details', () => {
  it('stores only the filled fields with Laravel keys', () => {
    expect(serializeBankDetails({ accountHolderName: ' Nimal ', accountNumber: '123', bankName: '', branch: '  ' })).toBe(
      '{"account_holder_name":"Nimal","account_number":"123"}',
    );
  });
  it('stores nothing when empty', () => {
    expect(serializeBankDetails({ bankName: '' })).toBeNull();
    expect(serializeBankDetails(undefined)).toBeNull();
  });
  it('reads what Laravel stored and survives bad data', () => {
    expect(parseBankDetails('{"bank_name":"BOC","tax_payer_id":"T1","branch":null}')).toEqual({
      accountHolderName: '',
      accountNumber: '',
      bankName: 'BOC',
      bankCode: '',
      branch: '',
      taxPayerId: 'T1',
    });
    expect(parseBankDetails('not json').bankName).toBe('');
    expect(parseBankDetails(null).bankName).toBe('');
  });
});

describe('date of birth', () => {
  it('round-trips a date', () => {
    expect(formatDob(parseDob('1990-02-28'))).toBe('1990-02-28');
    expect(parseDob(undefined)).toBeNull();
    expect(formatDob(null)).toBeNull();
  });
  it('rejects impossible and future dates', () => {
    expect(() => parseDob('1990-02-30')).toThrow();
    expect(() => parseDob('28/02/1990')).toThrow();
    expect(() => parseDob('2999-01-01')).toThrow();
  });
});

describe('location access', () => {
  it('reads all-locations and individual grants from permission names', () => {
    expect(locationAccessOf(['user.view', 'location.3', 'location.1', 'location.3'])).toEqual({ all: false, ids: [1, 3] });
    expect(locationAccessOf(['access_all_locations'])).toEqual({ all: true, ids: [] });
  });
  it('grants the chosen locations and revokes the rest', () => {
    expect(planLocationPermissions(['location.1', 'location.2', 'user.view'], { all: false, ids: [2, 3] })).toEqual({
      grant: ['location.3'],
      revoke: ['location.1'],
    });
  });
  it('replaces individual grants when all locations is chosen', () => {
    expect(planLocationPermissions(['location.1'], { all: true, ids: [] })).toEqual({ grant: ['access_all_locations'], revoke: ['location.1'] });
  });
  it('drops all-locations when specific ones are chosen', () => {
    expect(planLocationPermissions(['access_all_locations'], { all: false, ids: [4] })).toEqual({ grant: ['location.4'], revoke: ['access_all_locations'] });
  });
  it('does nothing when the access is unchanged and never touches other permissions', () => {
    expect(planLocationPermissions(['location.1', 'sell.view'], { all: false, ids: [1] })).toEqual({ grant: [], revoke: [] });
  });
  it('revokes everything when no location is chosen', () => {
    expect(planLocationPermissions(['location.1', 'access_all_locations'], { all: false, ids: [] })).toEqual({
      grant: [],
      revoke: ['location.1', 'access_all_locations'],
    });
  });
  it('rejects locations of another business', () => {
    expect(() => assertLocationsValid({ all: false, ids: [1, 9] }, new Set([1, 2]))).toThrow(/9/);
    expect(() => assertLocationsValid({ all: false, ids: [1] }, new Set([1, 2]))).not.toThrow();
    expect(() => assertLocationsValid({ all: true, ids: [] }, new Set())).not.toThrow();
  });
});

describe('protecting admins and yourself', () => {
  it('keeps admin accounts away from non-admins', () => {
    expect(() => assertCanManageTarget(true, false)).toThrow();
    expect(() => assertCanManageTarget(true, true)).not.toThrow();
    expect(() => assertCanManageTarget(false, false)).not.toThrow();
  });
  it('stops people locking themselves out', () => {
    expect(() => assertSelfEditSafe({ actorId: 1, targetId: 1, allowLogin: false, status: 'active' })).toThrow();
    expect(() => assertSelfEditSafe({ actorId: 1, targetId: 1, allowLogin: true, status: 'inactive' })).toThrow();
    expect(() => assertSelfEditSafe({ actorId: 1, targetId: 1, allowLogin: true, status: 'active' })).not.toThrow();
    expect(() => assertSelfEditSafe({ actorId: 1, targetId: 2, allowLogin: false, status: 'inactive' })).not.toThrow();
  });
});
