// Every Drizzle table of the application is exported from this file,
// which drizzle-kit reads to generate migrations.
import {
  bigint,
  char,
  check,
  type AnyPgColumn,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { EVENT_TYPES, type JsonObject } from '../events/domain/event.js';
import { PROJECT_STATUSES } from '../projects/domain/project.js';

export const projectStatus = pgEnum('project_status', PROJECT_STATUSES);

export const projects = pgTable(
  'projects',
  {
    id: text().primaryKey(),
    label: text().notNull(),
    ownerSiren: char({ length: 9 }).notNull(),
    status: projectStatus().notNull(),
    mergedInto: text().references((): AnyPgColumn => projects.id),
    splitInto: text().array(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A project is MERGED exactly when it points to the survivor, which is
    // another project.
    check(
      'projects_merged_into_check',
      sql`(${table.status} = 'MERGED') = (${table.mergedInto} is not null) and ${table.mergedInto} <> ${table.id}`,
    ),
    // A project is SPLIT exactly when it lists its successors, at least two.
    check(
      'projects_split_into_check',
      sql`(${table.status} = 'SPLIT') = (${table.splitInto} is not null) and cardinality(${table.splitInto}) >= 2`,
    ),
  ],
);

// The primary key enforces that a source key belongs to at most one project.
export const sourceKeys = pgTable(
  'source_keys',
  {
    system: text().notNull(),
    externalId: text().notNull(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    // The project the key was first attached to, kept when a merge transfers
    // the key: it is the project a replayed registration refers to.
    originProjectId: text()
      .notNull()
      .references(() => projects.id),
    attachedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'source_keys_pkey',
      columns: [table.system, table.externalId],
    }),
    index().on(table.projectId),
  ],
);

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
