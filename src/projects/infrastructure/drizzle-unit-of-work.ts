import type { Database } from '../../database/database.module.js';
import { DrizzleEventLog } from '../../events/infrastructure/drizzle-event-log.js';
import type {
  RegistryTransaction,
  UnitOfWork,
} from '../application/unit-of-work.js';
import { DrizzleProjectRepository } from './drizzle-project-repository.js';

// The only place where repositories are bound to a transaction, so a command
// cannot write outside of the transaction it runs in.
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(work: (tx: RegistryTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) =>
      work({
        projects: new DrizzleProjectRepository(tx),
        events: new DrizzleEventLog(tx),
      }),
    );
  }
}
