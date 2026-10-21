import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DATABASE } from '../../src/database/database.module.js';
import type { EventLogEntry } from '../../src/events/domain/event.js';
import { DrizzleEventLog } from '../../src/events/infrastructure/drizzle-event-log.js';
import { anEvent } from '../support/events.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

const EVENTS_PATH = '/v1/events';
const MAX_PAGE_SIZE = 200;

describe('GET /v1/events', () => {
  let app: INestApplication<App>;
  let eventLog: DrizzleEventLog;

  beforeAll(async () => {
    app = await createTestApp();
    eventLog = new DrizzleEventLog(app.get(DATABASE));
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an empty first page when the event log is empty', async () => {
    const response = await request(app.getHttpServer()).get(EVENTS_PATH);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [],
      pagination: { after: 0, limit: 50, nextAfter: null },
    });
  });

  it('returns appended events in sequence order with all their fields', async () => {
    const survivor = 'PRJ-7KQ2-M9XD';
    const absorbed = 'PRJ-AB12-CD34';
    const registered = await eventLog.append(
      anEvent({ projectIds: [survivor] }),
    );
    const merged = await eventLog.append(
      anEvent({
        type: 'ProjectsMerged',
        projectIds: [survivor, absorbed],
        payload: { survivor, absorbed: [absorbed] },
      }),
    );

    const response = await request(app.getHttpServer()).get(EVENTS_PATH);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([asJson(registered), asJson(merged)]);
  });

  it('pages through the log with the after cursor until the last page', async () => {
    const pageSize = 2;
    const [first, second, third] = [
      await eventLog.append(anEvent()),
      await eventLog.append(anEvent()),
      await eventLog.append(anEvent()),
    ];

    const firstPage = await request(app.getHttpServer())
      .get(EVENTS_PATH)
      .query({ limit: pageSize });

    expect(firstPage.status).toBe(200);
    expect(sequencesOf(firstPage.body)).toEqual([
      first.sequence,
      second.sequence,
    ]);
    expect(firstPage.body.pagination).toEqual({
      after: 0,
      limit: pageSize,
      nextAfter: second.sequence,
    });

    const lastPage = await request(app.getHttpServer())
      .get(EVENTS_PATH)
      .query({ after: firstPage.body.pagination.nextAfter, limit: pageSize });

    expect(lastPage.status).toBe(200);
    expect(sequencesOf(lastPage.body)).toEqual([third.sequence]);
    expect(lastPage.body.pagination).toEqual({
      after: second.sequence,
      limit: pageSize,
      nextAfter: null,
    });
  });

  it('accepts the maximum page size', async () => {
    const response = await request(app.getHttpServer())
      .get(EVENTS_PATH)
      .query({ limit: MAX_PAGE_SIZE });

    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBe(MAX_PAGE_SIZE);
  });

  it.each([
    { query: { after: -1 }, field: 'after' },
    { query: { after: 'abc' }, field: 'after' },
    { query: { after: 1.5 }, field: 'after' },
    { query: { after: '99999999999999999999' }, field: 'after' },
    { query: { limit: 0 }, field: 'limit' },
    { query: { limit: MAX_PAGE_SIZE + 1 }, field: 'limit' },
    { query: { cursor: 3 }, field: 'cursor' },
  ])(
    'rejects $query as a validation problem on $field',
    async ({ query, field }) => {
      const response = await request(app.getHttpServer())
        .get(EVENTS_PATH)
        .query(query);

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toMatch(
        /^application\/problem\+json/,
      );
      expect(response.body).toEqual({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'The request is invalid',
        errors: [
          { field, messages: expect.arrayContaining([expect.any(String)]) },
        ],
      });
    },
  );
});

// The HTTP representation of a stored entry: same fields, ISO 8601 date.
function asJson(entry: EventLogEntry): Record<string, unknown> {
  return { ...entry, occurredAt: entry.occurredAt.toISOString() };
}

function sequencesOf(body: { data: { sequence: number }[] }): number[] {
  return body.data.map(({ sequence }) => sequence);
}
