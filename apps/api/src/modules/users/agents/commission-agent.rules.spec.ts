import { AGENT_DEFAULTS, agentColumns } from './commission-agent.rules';

describe('agentColumns', () => {
  it('trims text and stores blanks as NULL', () => {
    expect(agentColumns({ surname: ' Mr ', firstName: ' Sunil ', lastName: '', email: ' ', contactNo: '0771234567', address: undefined, cmmsnPercent: 2.5 })).toEqual({
      surname: 'Mr',
      first_name: 'Sunil',
      last_name: null,
      email: null,
      contact_no: '0771234567',
      address: null,
      cmmsn_percent: '2.50',
    });
  });
  it('requires a first name', () => {
    expect(() => agentColumns({ firstName: '   ', cmmsnPercent: 1 })).toThrow(/First name/);
  });
  it('keeps the commission inside what the column holds', () => {
    expect(agentColumns({ firstName: 'A', cmmsnPercent: 0 }).cmmsn_percent).toBe('0.00');
    expect(() => agentColumns({ firstName: 'A', cmmsnPercent: 100 })).toThrow();
    expect(() => agentColumns({ firstName: 'A', cmmsnPercent: -0.5 })).toThrow();
  });
  it('creates agents that can never sign in', () => {
    expect(AGENT_DEFAULTS).toEqual({ is_cmmsn_agnt: true, allow_login: false, user_type: 'user', username: null, password: null });
  });
});
