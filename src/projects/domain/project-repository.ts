import type { ProjectId } from './project-id.js';
import type { NewProject, Project, SourceKey } from './project.js';

export interface ProjectRepository {
  findById(id: ProjectId): Promise<Project | null>;
  findBySourceKey(key: SourceKey): Promise<Project | null>;
  // Fails with DuplicateProjectId when the id is already taken, and with
  // DuplicateSourceKey when a concurrent transaction registered one of the
  // project's source keys first.
  insert(project: NewProject): Promise<Project>;
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
