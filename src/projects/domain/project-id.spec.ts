import { generateProjectId, isProjectId } from './project-id.js';

const bytes =
  (...values: number[]) =>
  () =>
    Uint8Array.from(values);

describe('generateProjectId', () => {
  it.each([
    { random: [0x00, 0x00, 0x00, 0x00, 0x00], id: 'PRJ-0000-0000' },
    { random: [0xff, 0xff, 0xff, 0xff, 0xff], id: 'PRJ-ZZZZ-ZZZZ' },
    // 5-bit groups 0 to 7.
    { random: [0x00, 0x44, 0x32, 0x14, 0xc7], id: 'PRJ-0123-4567' },
    // 5-bit groups 16 to 23: the alphabet skips I and L, then O.
    { random: [0x84, 0x65, 0x3a, 0x56, 0xd7], id: 'PRJ-GHJK-MNPQ' },
  ])('encodes $random as $id', ({ random, id }) => {
    expect(generateProjectId(bytes(...random))).toBe(id);
  });

  it('draws exactly 40 random bits', () => {
    const sizes: number[] = [];

    generateProjectId((size) => {
      sizes.push(size);
      return new Uint8Array(size);
    });

    expect(sizes).toEqual([5]);
  });
});

describe('isProjectId', () => {
  it('accepts the format of a generated id', () => {
    expect(isProjectId('PRJ-7KQ2-M9XD')).toBe(true);
  });

  it.each([
    { id: 'prj-7kq2-m9xd', reason: 'lowercase' },
    { id: 'PRJ-7KQ2-M9XI', reason: 'a letter outside Crockford Base32' },
    { id: 'PRJ-7KQ2-M9X', reason: 'a missing character' },
    { id: 'PRJ-7KQ2M9XD', reason: 'a missing separator' },
    { id: 'PRJ-7KQ2-M9XD\u0000', reason: 'a trailing NUL character' },
  ])('rejects $id: $reason', ({ id }) => {
    expect(isProjectId(id)).toBe(false);
  });
});
