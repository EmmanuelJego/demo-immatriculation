import { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../src/database/database.module.js';
import { projectEvents } from '../../src/database/schema.js';
import { DrizzleEventLog } from '../../src/events/infrastructure/drizzle-event-log.js';
import { anEvent } from '../support/events.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

const FIRST_PAGE = { after: 0, limit: 10 };
const APPEND_ONLY_VIOLATION = /append-only/;

describe('Event log', () => {
  let app: INestApplication;
  let db: Database;
  let eventLog: DrizzleEventLog;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DATABASE);
    eventLog = new DrizzleEventLog(db);
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('append', () => {
    it('returns the stored entry with its sequence and occurrence date', async () => {
      const event = anEvent();

      const entry = await eventLog.append(event);

      expect(entry).toEqual({
        ...event,
        sequence: 1,
        occurredAt: expect.any(Date),
      });
    });

    it('assigns strictly increasing sequences', async () => {
      const first = await eventLog.append(anEvent());
      const second = await eventLog.append(anEvent());

      expect(second.sequence).toBeGreaterThan(first.sequence);
    });

    // A reader that saw a later sequence before an earlier one was committed
    // would move its cursor past the earlier one and never read it.
    it('never exposes a sequence before every lower sequence is committed', async () => {
      const firstAppended = deferred();
      const releaseFirst = deferred();
      const slowCommand = db.transaction(async (tx) => {
        await new DrizzleEventLog(tx).append(anEvent());
        firstAppended.resolve();
        await releaseFirst.promise;
      });
      await firstAppended.promise;

      const fastCommand = db.transaction((tx) =>
        new DrizzleEventLog(tx).append(anEvent()),
      );
      await settleBriefly();
      const visibleWhileFirstIsOpen = await eventLog.list(FIRST_PAGE);

      releaseFirst.resolve();
      await Promise.all([slowCommand, fastCommand]);
      expect(visibleWhileFirstIsOpen.items).toEqual([]);
    });

    it('dates events in sequence order, even when a later sequence comes from an earlier transaction', async () => {
      const earlyStarted = deferred();
      const lateAppended = deferred();
      const earlyCommand = db.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        earlyStarted.resolve();
        await lateAppended.promise;
        return new DrizzleEventLog(tx).append(anEvent());
      });
      await earlyStarted.promise;
      const lateCommand = db.transaction(async (tx) => {
        const entry = await new DrizzleEventLog(tx).append(anEvent());
        lateAppended.resolve();
        return entry;
      });

      const [early, late] = await Promise.all([earlyCommand, lateCommand]);

      expect(early.sequence).toBeGreaterThan(late.sequence);
      expect(early.occurredAt.getTime()).toBeGreaterThanOrEqual(
        late.occurredAt.getTime(),
      );
    });

    it('keeps nothing when the enclosing transaction is rolled back', async () => {
      const failure = 'command failed after writing its event';
      const failingCommand = db.transaction(async (tx) => {
        await new DrizzleEventLog(tx).append(anEvent());
        throw new Error(failure);
      });

      await expect(failingCommand).rejects.toThrow(failure);
      const page = await eventLog.list(FIRST_PAGE);
      expect(page.items).toEqual([]);
    });
  });

  describe('append-only guarantee', () => {
    it('rejects any update of a stored event', async () => {
      const entry = await eventLog.append(anEvent());

      const update = db
        .update(projectEvents)
        .set({ payload: { label: 'rewritten history' } })
        .where(eq(projectEvents.sequence, entry.sequence));

      await expectCause(update, APPEND_ONLY_VIOLATION);
    });

    it('rejects any deletion of a stored event', async () => {
      const entry = await eventLog.append(anEvent());

      const deletion = db
        .delete(projectEvents)
        .where(eq(projectEvents.sequence, entry.sequence));

      await expectCause(deletion, APPEND_ONLY_VIOLATION);
      const page = await eventLog.list(FIRST_PAGE);
      expect(page.items).toHaveLength(1);
    });
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

// Leaves a concurrent transaction enough time to commit if nothing blocks it.
const settleBriefly = () => new Promise((done) => setTimeout(done, 200));

// Drizzle wraps driver errors: PostgreSQL's message is on `cause`.
async function expectCause(
  query: PromiseLike<unknown>,
  message: RegExp,
): Promise<void> {
  const error: unknown = await Promise.resolve(query).then(
    () => expect.fail('query should have been rejected'),
    (rejection: unknown) => rejection,
  );
  expect(error).toHaveProperty('cause.message', expect.stringMatching(message));
}
