export const PROJECTS_PATH = '/v1/projects';

// `PRJ-XXXX-XXXX` in Crockford Base32: digits and letters, without I, L, O, U.
export const PROJECT_ID_FORMAT =
  /^PRJ-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

// Real SIREN of the city of Toulouse, with a valid Luhn check digit.
export const TOULOUSE_SIREN = '213105554';

export interface Registration {
  label: string;
  ownerSiren: string;
  sourceKey: { system: string; externalId: string };
}

export function aRegistration(
  overrides: Partial<Registration> = {},
): Registration {
  return {
    label: 'Rénovation de l’école Jean Jaurès',
    ownerSiren: TOULOUSE_SIREN,
    sourceKey: { system: 'dotations', externalId: 'DOS-2026-0001' },
    ...overrides,
  };
}

// A source key other than the default one of `aRegistration()`.
export const ANOTHER_SOURCE_KEY = {
  system: 'guichet-unique',
  externalId: 'GU-42',
};
