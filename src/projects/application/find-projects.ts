import { Inject, Injectable } from '@nestjs/common';
import type { Project, SourceKey } from '../domain/project.js';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.js';

@Injectable()
export class FindProjects {
  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  // A source key belongs to at most one project: the list has 0 or 1 item.
  async bySourceKey(key: SourceKey): Promise<Project[]> {
    const project = await this.unitOfWork.run(({ projects }) =>
      projects.findBySourceKey(key),
    );
    return project ? [project] : [];
  }
}
