import { Inject, Injectable } from '@nestjs/common';
import { ProjectNotFound } from '../domain/errors.js';
import { isProjectId, type ProjectId } from '../domain/project-id.js';
import {
  resolveSplit,
  splitProject,
  type NewSuccessor,
  type Project,
} from '../domain/project.js';
import {
  PROJECT_ID_GENERATOR,
  type ProjectIdGenerator,
} from './register-project.js';
import { retryOnDuplicate } from './retry.js';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.js';

export interface SplitResult {
  readonly source: Project;
  readonly successors: readonly Project[];
  readonly created: boolean;
}

@Injectable()
export class SplitProject {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(PROJECT_ID_GENERATOR)
    private readonly generateId: ProjectIdGenerator,
  ) {}

  execute(
    sourceId: string,
    successors: readonly NewSuccessor[],
  ): Promise<SplitResult> {
    if (!isProjectId(sourceId)) {
      throw new ProjectNotFound(sourceId);
    }
    return retryOnDuplicate(() => this.attempt(sourceId, successors));
  }

  private attempt(
    sourceId: ProjectId,
    successors: readonly NewSuccessor[],
  ): Promise<SplitResult> {
    return this.unitOfWork.run(async ({ projects, events }) => {
      const source = await projects.findByIdForUpdate(sourceId);
      if (!source) {
        throw new ProjectNotFound(sourceId);
      }
      if (source.splitInto) {
        // Read without locks, which would break the ascending id order. The
        // replay compares the successors as they are now (see CHOICES.md).
        const existing = await projects.findManyById(source.splitInto);
        return {
          source,
          successors: resolveSplit(source, existing, successors),
          created: false,
        };
      }
      const owners = await projects.findSourceKeyOwners(
        successors.flatMap(({ sourceKeys }) => sourceKeys),
      );
      const split = splitProject(
        source,
        successors,
        successors.map(() => this.generateId()),
        owners,
      );
      const stored = await projects.split(sourceId, split.successors);
      await events.append(split.event);
      return { ...stored, created: true };
    });
  }
}
