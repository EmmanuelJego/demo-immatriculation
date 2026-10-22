import { Inject, Injectable } from '@nestjs/common';
import { AbsorbedProjectNotFound, ProjectNotFound } from '../domain/errors.js';
import { isProjectId, type ProjectId } from '../domain/project-id.js';
import { mergeProjects, type Project } from '../domain/project.js';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.js';

@Injectable()
export class MergeProjects {
  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  execute(
    survivorId: string,
    absorbedIds: readonly ProjectId[],
  ): Promise<Project> {
    if (!isProjectId(survivorId)) {
      throw new ProjectNotFound(survivorId);
    }
    return this.unitOfWork.run(async ({ projects, events }) => {
      const locked = await projects.findManyByIdForUpdate([
        survivorId,
        ...absorbedIds,
      ]);
      const find = (id: ProjectId) =>
        locked.find((project) => project.id === id);
      const survivor = find(survivorId);
      if (!survivor) {
        throw new ProjectNotFound(survivorId);
      }
      // In the order of the request, not in the order of the locks.
      const absorbed = absorbedIds.map((id) => {
        const project = find(id);
        if (!project) {
          throw new AbsorbedProjectNotFound(id);
        }
        return project;
      });
      const merger = mergeProjects(survivor, absorbed);
      if (!merger.event) {
        return survivor;
      }
      const merged = await projects.mergeInto(
        survivorId,
        merger.absorbed.map(({ id }) => id),
      );
      await events.append(merger.event);
      return merged;
    });
  }
}
