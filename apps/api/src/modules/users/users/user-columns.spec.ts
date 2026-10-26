import { PersonalInfoDto } from './user.dto';
import { personalInfoColumns } from './user-columns';

const dto = (over: Partial<PersonalInfoDto> = {}): PersonalInfoDto => Object.assign(new PersonalInfoDto(), { firstName: ' Nimal ', ...over });

describe('personalInfoColumns', () => {
  it('trims the name and turns blanks into NULL', () => {
    const c = personalInfoColumns(dto({ surname: ' Mr ', lastName: '  ', contactNumber: '0771234567' }));
    expect(c.first_name).toBe('Nimal');
    expect(c.surname).toBe('Mr');
    expect(c.last_name).toBeNull();
    expect(c.contact_number).toBe('0771234567');
  });
  it('leaves fields that were not sent untouched (undefined)', () => {
    const c = personalInfoColumns(dto());
    expect(c.surname).toBeUndefined();
    expect(c.dob).toBeUndefined();
    expect(c.bank_details).toBeUndefined();
    expect(c.language).toBeUndefined();
    expect(c.gender).toBeUndefined();
    expect(c.marital_status).toBeUndefined();
  });
  it('parses dates and clears them with an empty string', () => {
    expect(personalInfoColumns(dto({ dob: '1990-05-01' })).dob?.toISOString()).toBe('1990-05-01T00:00:00.000Z');
    expect(personalInfoColumns(dto({ dob: '' })).dob).toBeNull();
    expect(() => personalInfoColumns(dto({ dob: 'tomorrow' }))).toThrow();
  });
  it('stores gender and marital status only when valid', () => {
    expect(personalInfoColumns(dto({ gender: 'female', maritalStatus: 'married' }))).toMatchObject({ gender: 'female', marital_status: 'married' });
    expect(personalInfoColumns(dto({ gender: '', maritalStatus: '' }))).toMatchObject({ gender: null, marital_status: null });
  });
  it('serialises bank details with the Laravel keys', () => {
    expect(personalInfoColumns(dto({ bankDetails: { bankName: 'BOC', branch: 'Passara' } })).bank_details).toBe('{"bank_name":"BOC","branch":"Passara"}');
    expect(personalInfoColumns(dto({ bankDetails: {} })).bank_details).toBeNull();
  });
});
