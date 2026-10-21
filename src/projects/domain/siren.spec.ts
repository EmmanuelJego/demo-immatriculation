import { isValidSiren } from './siren.js';

describe('isValidSiren', () => {
  it.each([
    { siren: '213105554', owner: 'Toulouse' },
    { siren: '217500016', owner: 'Paris' },
  ])('accepts the SIREN of $owner', ({ siren }) => {
    expect(isValidSiren(siren)).toBe(true);
  });

  it.each([
    {
      siren: '213105555',
      reason: 'a wrong check digit (typo on the last digit)',
    },
    { siren: '231105554', reason: 'two swapped digits' },
    { siren: '21310555', reason: '8 digits' },
    { siren: '2131055540', reason: '10 digits' },
    { siren: '21310555A', reason: 'a letter' },
    { siren: '213 105 554', reason: 'spaces' },
    { siren: '', reason: 'an empty value' },
  ])('rejects $siren: $reason', ({ siren }) => {
    expect(isValidSiren(siren)).toBe(false);
  });
});
