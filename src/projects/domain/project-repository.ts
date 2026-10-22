import type { ProjectId } from './project-id.js';
import type {
  NewProject,
  Project,
  SourceKey,
  SourceKeyOwnership,
} from './project.js';

export interface StoredSplit {
  readonly source: Project;
  readonly successors: readonly Project[];
}

export interface ProjectRepository {
  findById(id: ProjectId): Promise<Project | null>;
  // In the order of `ids`, unknown ids left out.
  findManyById(ids: readonly ProjectId[]): Promise<Project[]>;
  // The project the key was first attached to, whichever project owns it now.
  findSourceKeyOrigin(key: SourceKey): Promise<Project | null>;
  // Locks the project until the end of the transaction, so that concurrent
  // commands on it run one after the other.
  findByIdForUpdate(id: ProjectId): Promise<Project | null>;
  // Locks the projects found, in ascending id order: commands locking
  // several projects all take their locks in the same order, so they cannot
  // deadlock. Unknown ids are left out of the result.
  findManyByIdForUpdate(ids: readonly ProjectId[]): Promise<Project[]>;
  findSourceKeyOwner(key: SourceKey): Promise<ProjectId | null>;
  // The keys among `keys` that are attached to a project, with that project.
  findSourceKeyOwners(
    keys: readonly SourceKey[],
  ): Promise<SourceKeyOwnership[]>;
  // Fails with DuplicateProjectId when the id is already taken, and with
  // DuplicateSourceKey when a concurrent transaction registered one of the
  // project's source keys first.
  insert(project: NewProject): Promise<Project>;
  // Fails with DuplicateSourceKey when a concurrent transaction attached or
  // registered the key first.
  attachSourceKey(projectId: ProjectId, key: SourceKey): Promise<void>;
  // Transfers the source keys of the absorbed projects to the survivor and
  // closes them, then returns the survivor as stored. All of them must have
  // been locked first, by findManyByIdForUpdate.
  mergeInto(
    survivorId: ProjectId,
    absorbedIds: readonly ProjectId[],
  ): Promise<Project>;
  // Creates the successors, transfers to them the keys of the source they
  // list and attaches the others, then closes the source, which must have
  // been locked first. Fails with DuplicateProjectId or DuplicateSourceKey
  // when a concurrent transaction took an id or a key first.
  split(
    sourceId: ProjectId,
    successors: readonly NewProject[],
  ): Promise<StoredSplit>;
}

export class DuplicateSourceKey extends Error {
  constructor(options?: ErrorOptions) {
    super('A source key of the project is already registered', options);
  }
}

export class DuplicateProjectId extends Error {
  constructor(options?: ErrorOptions) {
    super('The project id is already taken', options);
  }
}
