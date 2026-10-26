import { BadRequestException } from '@nestjs/common';
import { cleanCommissionPercent } from '../users/user.rules';

export interface CommissionAgentInput {
  surname?: string;
  firstName: string;
  lastName?: string;
  email?: string;
  contactNo?: string;
  address?: string;
  cmmsnPercent: number;
}

function blankToNull(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

/**
 * Columns of a sales commission agent. Same as Laravel: an agent is a `users` row that can never log in
 * (`allow_login = 0`, no username or password) and is flagged `is_cmmsn_agnt = 1`.
 */
export function agentColumns(input: CommissionAgentInput) {
  const firstName = (input.firstName ?? '').trim();
  if (!firstName) throw new BadRequestException('First name is required');
  return {
    surname: blankToNull(input.surname),
    first_name: firstName,
    last_name: blankToNull(input.lastName),
    email: blankToNull(input.email),
    contact_no: blankToNull(input.contactNo),
    address: blankToNull(input.address),
    cmmsn_percent: cleanCommissionPercent(input.cmmsnPercent),
  };
}

/** Fixed part written only when an agent is created. */
export const AGENT_DEFAULTS = {
  is_cmmsn_agnt: true,
  allow_login: false,
  user_type: 'user',
  username: null,
  password: null,
} as const;
