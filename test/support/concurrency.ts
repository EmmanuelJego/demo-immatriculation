import { sql } from 'drizzle-orm';
import type { Database } from '../../src/database/database.module.js';
import type { RegistryTransaction } from '../../src/projects/application/unit-of-work.js';
import { DrizzleUnitOfWork } from '../../src/projects/infrastructure/drizzle-unit-of-work.js';

// Below the Vitest test timeout (5 s), so that this error is the one reported.
const LOCK_WAIT_TIMEOUT_MS = 2_000;
const LOCK_WAIT_POLL_MS = 20;

export interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

export function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

// Resolves once another connection to the test database is blocked waiting
// for a lock, which proves that a concurrent transaction is actually stuck
// behind the one the test holds open. Fails if that never happens.
export async function waitForLockWait(db: Database): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows } = await db.execute<{ waiting: number }>(sql`
      select count(*)::int as waiting
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
    `);
    if (rows[0].waiting > 0) {
      return;
    }
    await new Promise((done) => setTimeout(done, LOCK_WAIT_POLL_MS));
  }
  throw new Error(
    `No connection waited for a lock within ${LOCK_WAIT_TIMEOUT_MS} ms`,
  );
}

// Runs `holder` in a transaction kept open until `contender` is blocked
// behind it on a lock, then runs `whileBlocked`, commits the holder and
// returns what `contender` returned.
export async function contendWith<T>(
  db: Database,
  holder: (tx: RegistryTransaction) => Promise<void>,
  contender: () => PromiseLike<T>,
  whileBlocked: () => Promise<void> = async () => {},
): Promise<T> {
  const held = deferred();
  const commit = deferred();
  const holding = new DrizzleUnitOfWork(db).run(async (tx) => {
    await holder(tx);
    held.resolve();
    await commit.promise;
  });
  // Fails fast, instead of waiting forever, when the holder itself fails.
  await Promise.race([held.promise, holding]);

  const contending = Promise.resolve(contender());
  try {
    await waitForLockWait(db);
    await whileBlocked();
  } catch (error) {
    // The contender is abandoned: keep its eventual failure from going unhandled.
    contending.catch(() => {});
    throw error;
  } finally {
    commit.resolve();
    await holding;
  }
  return contending;
}
