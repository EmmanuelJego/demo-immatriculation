import { and, arrayContains, asc, gt, sql } from 'drizzle-orm';
import {
  toPage,
  type Page,
  type PageQuery,
} from '../../common/pagination/page.js';
import type { DatabaseExecutor } from '../../database/database.module.js';
import { projectEvents } from '../../database/schema.js';
import type {
  EventFilter,
  EventLog,
  EventLogReader,
} from '../application/event-log.js';
import type { EventLogEntry, NewEvent } from '../domain/event.js';

// Appends are serialized until commit: otherwise a transaction holding a lower
// sequence could commit after a higher one, and cursor readers would skip it.
const APPEND_LOCK_KEY = 7_315_002_001;

export class DrizzleEventLog implements EventLog, EventLogReader {
  constructor(private readonly db: DatabaseExecutor) {}

  async append(event: NewEvent): Promise<EventLogEntry> {
    await this.db.execute(
      sql`select pg_advisory_xact_lock(${APPEND_LOCK_KEY})`,
    );
    const [row] = await this.db
      .insert(projectEvents)
      .values({ ...event, projectIds: [...event.projectIds] })
      .returning();
    return row;
  }

  async list(
    query: PageQuery,
    filter: EventFilter = {},
  ): Promise<Page<EventLogEntry>> {
    const rows = await this.db
      .select()
      .from(projectEvents)
      .where(
        and(
          gt(projectEvents.sequence, query.after),
          filter.projectId === undefined
            ? undefined
            : arrayContains(projectEvents.projectIds, [filter.projectId]),
        ),
      )
      .orderBy(asc(projectEvents.sequence))
      .limit(query.limit + 1);
    return toPage(rows, query, (entry) => entry.sequence);
  }
}
