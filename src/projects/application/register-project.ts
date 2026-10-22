import { Inject, Injectable } from '@nestjs/common';
import type { ProjectId } from '../domain/project-id.js';
import {
  registerProject,
  resolveRegistration,
  type Project,
  type Registration,
} from '../domain/project.js';
import { retryOnDuplicate } from './retry.js';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.js';

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

  execute(registration: Registration): Promise<RegistrationResult> {
    return retryOnDuplicate(() => this.attempt(registration));
  }

  private attempt(registration: Registration): Promise<RegistrationResult> {
    return this.unitOfWork.run(async ({ projects, events }) => {
      const existing = await projects.findSourceKeyOrigin(
        registration.sourceKey,
      );
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
