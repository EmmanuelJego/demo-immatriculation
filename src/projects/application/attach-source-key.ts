import { Inject, Injectable } from '@nestjs/common';
import { ProjectNotFound } from '../domain/errors.js';
import { isProjectId, type ProjectId } from '../domain/project-id.js';
import {
  attachSourceKey,
  type Project,
  type SourceKey,
} from '../domain/project.js';
import { retryOnDuplicate } from './retry.js';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.js';

export interface AttachmentResult {
  readonly project: Project;
  readonly attached: boolean;
}

@Injectable()
export class AttachSourceKey {
  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  execute(projectId: string, key: SourceKey): Promise<AttachmentResult> {
    if (!isProjectId(projectId)) {
      throw new ProjectNotFound(projectId);
    }
    return retryOnDuplicate(() => this.attempt(projectId, key));
  }

  private attempt(
    projectId: ProjectId,
    key: SourceKey,
  ): Promise<AttachmentResult> {
    return this.unitOfWork.run(async ({ projects, events }) => {
      const project = await projects.findByIdForUpdate(projectId);
      if (!project) {
        throw new ProjectNotFound(projectId);
      }
      const owner = await projects.findSourceKeyOwner(key);
      const attachment = attachSourceKey(project, key, owner);
      if (attachment.event) {
        await projects.attachSourceKey(projectId, key);
        await events.append(attachment.event);
      }
      return {
        project: attachment.project,
        attached: attachment.event !== null,
      };
    });
  }
}
