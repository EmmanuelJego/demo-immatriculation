import type { EventLog } from '../../events/application/event-log.js';
import type { ProjectRepository } from '../domain/project-repository.js';

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

// Everything a command may touch, bound to one database transaction.
export interface RegistryTransaction {
  readonly projects: ProjectRepository;
  readonly events: EventLog;
}

export interface UnitOfWork {
  run<T>(work: (tx: RegistryTransaction) => Promise<T>): Promise<T>;
}
