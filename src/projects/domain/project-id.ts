// Crockford Base32: no I, L, O or U, to avoid misreading when typed by hand.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BITS_PER_CHARACTER = 5;
const CHARACTER_COUNT = 8;
const RANDOM_BYTE_COUNT = (BITS_PER_CHARACTER * CHARACTER_COUNT) / 8;

export const PROJECT_ID_PATTERN = `^PRJ-[${ALPHABET}]{4}-[${ALPHABET}]{4}$`;
const ID_FORMAT = new RegExp(PROJECT_ID_PATTERN);

export type ProjectId = string;

export type RandomBytes = (size: number) => Uint8Array;

export function generateProjectId(randomBytes: RandomBytes): ProjectId {
  const value = randomBytes(RANDOM_BYTE_COUNT).reduce(
    (accumulated, byte) => (accumulated << 8n) | BigInt(byte),
    0n,
  );
  const characters = Array.from({ length: CHARACTER_COUNT }, (_, index) => {
    const shift = BigInt(BITS_PER_CHARACTER * (CHARACTER_COUNT - 1 - index));
    return ALPHABET[Number((value >> shift) & 0b11111n)];
  }).join('');
  return `PRJ-${characters.slice(0, 4)}-${characters.slice(4)}`;
}

export function isProjectId(value: string): value is ProjectId {
  return ID_FORMAT.test(value);
}
