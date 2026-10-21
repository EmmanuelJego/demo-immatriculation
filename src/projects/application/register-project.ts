import { Inject, Injectable } from '@nestjs/common';
import type { ProjectId } from '../domain/project-id.js';
import {
  DuplicateProjectId,
  DuplicateSourceKey,
} from '../domain/project-repository.js';
import {
  registerProject,
  resolveRegistration,
  type Project,
  type Registration,
} from '../domain/project.js';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.js';

const MAX_ATTEMPTS = 3;

export const PROJECT_ID_GENERATOR = Symbol('PROJECT_ID_GENERATOR');

export type ProjectIdGenerator = () => ProjectId;

export interface RegistrationResult {
  readonly project: Project;
  readonly created: boolean;
}

@Injectable()
export class RegisterProject {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(PROJECT_ID_GENERATOR)
    private readonly generateId: ProjectIdGenerator,
  ) {}

  // An attempt fails and rolls back when the drawn id is taken, or when a
  // concurrent registration of the same source key committed first. The next
  // attempt draws another id, or finds the project registered concurrently.
  async execute(registration: Registration): Promise<RegistrationResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.attempt(registration);
      } catch (error) {
        if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  private attempt(registration: Registration): Promise<RegistrationResult> {
    return this.unitOfWork.run(async ({ projects, events }) => {
      const existing = await projects.findBySourceKey(registration.sourceKey);
      if (existing) {
        return {
          project: resolveRegistration(existing, registration),
          created: false,
        };
      }
      const registered = registerProject(registration, this.generateId());
      const project = await projects.insert(registered.project);
      await events.append(registered.event);
      return { project, created: true };
    });
  }
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof DuplicateProjectId || error instanceof DuplicateSourceKey
  );
}
