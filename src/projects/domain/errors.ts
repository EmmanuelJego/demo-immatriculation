import { DomainError } from '../../common/errors/domain-error.js';
import type { ProjectId } from './project-id.js';
import type { ProjectStatus, SourceKey } from './project.js';

export class ProjectNotFound extends DomainError {
  readonly code = 'project-not-found';
  readonly kind = 'not-found';

  constructor(id: ProjectId) {
    super(`Project ${id} does not exist`);
  }
}

export class SourceKeyAlreadyRegistered extends DomainError {
  readonly code = 'source-key-already-registered';
  readonly kind = 'conflict';

  constructor(key: SourceKey, owner: ProjectId) {
    super(
      `Source key ${key.system}/${key.externalId} is already registered for project ${owner} with other attributes`,
    );
  }
}

export class SourceKeyOwnedByAnotherProject extends DomainError {
  readonly code = 'source-key-owned-by-another-project';
  readonly kind = 'conflict';

  constructor(key: SourceKey, owner: ProjectId) {
    super(
      `Source key ${key.system}/${key.externalId} belongs to project ${owner}`,
    );
  }
}

export class ProjectNotActive extends DomainError {
  readonly code = 'project-not-active';
  readonly kind = 'conflict';

  constructor(id: ProjectId, status: ProjectStatus) {
    super(`Project ${id} is ${status} and no longer accepts changes`);
  }
}
