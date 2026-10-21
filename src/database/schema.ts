// Every Drizzle table of the application is exported from this file,
// which drizzle-kit reads to generate migrations.
import {
  bigint,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { EVENT_TYPES, type JsonObject } from '../events/domain/event.js';

export const eventType = pgEnum('event_type', EVENT_TYPES);

export const projectEvents = pgTable('project_events', {
  sequence: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  type: eventType().notNull(),
  // Insert time, not transaction start time (now()): since appends are
  // serialized, dates then follow the sequence order.
  occurredAt: timestamp({ withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`),
  projectIds: text().array().notNull(),
  payload: jsonb().$type<JsonObject>().notNull(),
});
