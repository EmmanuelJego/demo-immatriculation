import { Inject, Injectable } from '@nestjs/common';
import { ProjectNotFound } from '../domain/errors.js';
import { isProjectId } from '../domain/project-id.js';
import type { Project } from '../domain/project.js';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.js';

@Injectable()
export class GetProject {
  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  // A malformed id cannot belong to any project, and must not reach the
  // database (PostgreSQL rejects some characters, such as NUL).
  async execute(id: string): Promise<Project> {
    if (!isProjectId(id)) {
      throw new ProjectNotFound(id);
    }
    const project = await this.unitOfWork.run(({ projects }) =>
      projects.findById(id),
    );
    if (!project) {
      throw new ProjectNotFound(id);
    }
    return project;
  }
}
