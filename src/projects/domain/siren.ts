const SIREN_FORMAT = /^\d{9}$/;

// A SIREN is 9 digits whose last one is a Luhn check digit.
export function isValidSiren(value: string): boolean {
  if (!SIREN_FORMAT.test(value)) {
    return false;
  }
  const sum = [...value].reverse().reduce((total, character, index) => {
    const digit = Number(character);
    const weighted = index % 2 === 1 ? digit * 2 : digit;
    return total + (weighted > 9 ? weighted - 9 : weighted);
  }, 0);
  return sum % 10 === 0;
}
