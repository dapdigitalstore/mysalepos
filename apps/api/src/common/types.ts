export interface AuthUser {
  id: number;
  businessId: number;
  username: string;
  firstName: string;
  lastName: string;
  language: string;
  isAdmin: boolean;
  isSuperadmin: boolean;
  permissions: string[];
  /** IANA name of the business time zone (business.time_zone), e.g. Asia/Colombo. */
  timeZone: string;
}

export interface JwtPayload {
  sub: number;
  bid: number;
  username: string;
}
