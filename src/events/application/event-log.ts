import type { Page, PageQuery } from '../../common/pagination/page.js';
import type { EventLogEntry, NewEvent } from '../domain/event.js';

export const EVENT_LOG_READER = Symbol('EVENT_LOG_READER');

// Write side: each use case builds one on its own transaction, so that a
// state change and its event are committed or rolled back together.
export interface EventLog {
  append(event: NewEvent): Promise<EventLogEntry>;
}

// Without a project id, the whole log.
export interface EventFilter {
  readonly projectId?: string;
}

export interface EventLogReader {
  list(query: PageQuery, filter?: EventFilter): Promise<Page<EventLogEntry>>;
}
