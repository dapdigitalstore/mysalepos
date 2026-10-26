import { PersonalInfoDto } from './user.dto';
import { parseDob, serializeBankDetails } from './user.rules';

/** '' and whitespace become NULL; undefined stays undefined so Prisma leaves the column alone. */
function text(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  return v === '' ? null : v;
}

const GENDERS: readonly string[] = ['male', 'female', 'others'];
const MARITAL = ['married', 'unmarried', 'divorced'] as const;
type Marital = (typeof MARITAL)[number];

export interface PersonalColumns {
  surname?: string | null;
  first_name: string;
  last_name?: string | null;
  language?: string;
  dob?: Date | null;
  gender?: string | null;
  marital_status?: Marital | null;
  blood_group?: string | null;
  contact_number?: string | null;
  alt_number?: string | null;
  family_number?: string | null;
  fb_link?: string | null;
  twitter_link?: string | null;
  social_media_1?: string | null;
  social_media_2?: string | null;
  custom_field_1?: string | null;
  custom_field_2?: string | null;
  custom_field_3?: string | null;
  custom_field_4?: string | null;
  guardian_name?: string | null;
  id_proof_name?: string | null;
  id_proof_number?: string | null;
  permanent_address?: string | null;
  current_address?: string | null;
  bank_details?: string | null;
}

/** Maps the personal block of the user/profile forms to `users` columns. */
export function personalInfoColumns(dto: PersonalInfoDto): PersonalColumns {
  const gender = text(dto.gender);
  const marital = text(dto.maritalStatus);
  return {
    surname: text(dto.surname),
    first_name: dto.firstName.trim(),
    last_name: text(dto.lastName),
    language: text(dto.language) ?? undefined,
    dob: dto.dob === undefined ? undefined : dto.dob.trim() === '' ? null : parseDob(dto.dob.trim()),
    gender: gender && !GENDERS.includes(gender) ? null : gender,
    marital_status: marital === undefined ? undefined : marital && (MARITAL as readonly string[]).includes(marital) ? (marital as Marital) : null,
    blood_group: text(dto.bloodGroup),
    contact_number: text(dto.contactNumber),
    alt_number: text(dto.altNumber),
    family_number: text(dto.familyNumber),
    fb_link: text(dto.fbLink),
    twitter_link: text(dto.twitterLink),
    social_media_1: text(dto.socialMedia1),
    social_media_2: text(dto.socialMedia2),
    custom_field_1: text(dto.customField1),
    custom_field_2: text(dto.customField2),
    custom_field_3: text(dto.customField3),
    custom_field_4: text(dto.customField4),
    guardian_name: text(dto.guardianName),
    id_proof_name: text(dto.idProofName),
    id_proof_number: text(dto.idProofNumber),
    permanent_address: text(dto.permanentAddress),
    current_address: text(dto.currentAddress),
    bank_details: dto.bankDetails === undefined ? undefined : serializeBankDetails(dto.bankDetails),
  };
}
