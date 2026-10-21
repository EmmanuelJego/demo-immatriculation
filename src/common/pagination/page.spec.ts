import { toPage } from './page.js';

const cursorOf = (item: { sequence: number }) => item.sequence;
const items = (...sequences: number[]) =>
  sequences.map((sequence) => ({ sequence }));

describe('toPage', () => {
  it('returns every row and no next cursor when fewer rows than the limit were found', () => {
    const rows = items(4, 5);
    const query = { after: 3, limit: 3 };

    const page = toPage(rows, query, cursorOf);

    expect(page).toEqual({
      items: rows,
      after: query.after,
      limit: query.limit,
      nextAfter: null,
    });
  });

  it('returns no next cursor when exactly the limit was found', () => {
    const rows = items(1, 2, 3);

    const page = toPage(rows, { after: 0, limit: 3 }, cursorOf);

    expect(page.items).toEqual(rows);
    expect(page.nextAfter).toBeNull();
  });

  it('drops the look-ahead row and points the next cursor at the last returned item', () => {
    const page = toPage(items(1, 2, 3, 7), { after: 0, limit: 3 }, cursorOf);

    expect(page.items).toEqual(items(1, 2, 3));
    expect(page.nextAfter).toBe(3);
  });
});
