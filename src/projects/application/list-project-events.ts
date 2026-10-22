import { Inject, Injectable } from '@nestjs/common';
import type { Page, PageQuery } from '../../common/pagination/page.js';
import {
  EVENT_LOG_READER,
  type EventLogReader,
} from '../../events/application/event-log.js';
import type { EventLogEntry } from '../../events/domain/event.js';
import { GetProject } from './get-project.js';

@Injectable()
export class ListProjectEvents {
  constructor(
    private readonly getProject: GetProject,
    @Inject(EVENT_LOG_READER) private readonly eventLog: EventLogReader,
  ) {}

  // A missing project is reported as such, rather than as an empty history.
  // The check and the read are two transactions, which is safe: a project is
  // never deleted, so one found by the check is still there for the read.
  async execute(
    projectId: string,
    query: PageQuery,
  ): Promise<Page<EventLogEntry>> {
    const { id } = await this.getProject.execute(projectId);
    return this.eventLog.list(query, { projectId: id });
  }
}
