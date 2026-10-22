import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { eventLog } from '../support/events.js';
import {
  ANOTHER_SOURCE_KEY,
  aRegistration,
  PROJECTS_PATH,
  registerProject,
} from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

const THIRD_SOURCE_KEY = { system: 'aides-territoires', externalId: 'AT-7' };
const FOURTH_SOURCE_KEY = { system: 'aides-territoires', externalId: 'AT-8' };
const FIFTH_SOURCE_KEY = { system: 'aides-territoires', externalId: 'AT-9' };
const SIXTH_SOURCE_KEY = { system: 'aides-territoires', externalId: 'AT-10' };

describe('GET /v1/projects/{id}/events', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  function projectEvents(id: string, query: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .get(`${PROJECTS_PATH}/${encodeURIComponent(id)}/events`)
      .query(query);
  }

  function attach(id: string, sourceKey: object) {
    return request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${id}/source-keys`)
      .send(sourceKey);
  }

  it('lists the events of the project alone, in sequence order', async () => {
    const project = await registerProject(app);
    await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    await attach(project.id, THIRD_SOURCE_KEY);
    const [registered, , attached] = await eventLog(app);

    const response = await projectEvents(project.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [registered, attached],
      pagination: { after: 0, limit: 50, nextAfter: null },
    });
  });

  it.each([
    { case: 'an unknown project', id: 'PRJ-0000-0000' },
    { case: 'a malformed id', id: 'not-a-registration-id' },
    { case: 'an id with a NUL character', id: 'PRJ-\u0000' },
  ])('reports $case as a missing project', async ({ id }) => {
    const response = await projectEvents(id);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:project-not-found',
      title: 'Not Found',
      status: 404,
      detail: `Project ${id} does not exist`,
    });
  });

  it('pages through the events of the project alone, interleaved with others', async () => {
    const project = await registerProject(app);
    const other = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    await attach(other.id, FOURTH_SOURCE_KEY);
    await attach(project.id, THIRD_SOURCE_KEY);
    await attach(other.id, FIFTH_SOURCE_KEY);
    await attach(project.id, SIXTH_SOURCE_KEY);
    const events = (await eventLog(app)) as { sequence: number }[];
    const [registered, , , attached, , attachedLast] = events;
    const pageSize = 2;

    const first = await projectEvents(project.id, { limit: pageSize });
    const last = await projectEvents(project.id, {
      limit: pageSize,
      after: first.body.pagination.nextAfter,
    });

    expect(first.body).toEqual({
      data: [registered, attached],
      pagination: { after: 0, limit: pageSize, nextAfter: attached.sequence },
    });
    expect(last.body).toEqual({
      data: [attachedLast],
      pagination: {
        after: attached.sequence,
        limit: pageSize,
        nextAfter: null,
      },
    });
  });

  it('keeps the merge in the history of the absorbed project', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    await request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${survivor.id}/merges`)
      .send({ absorbed: [absorbed.id] });

    const response = await projectEvents(absorbed.id);

    expect(
      response.body.data.map(({ type }: { type: string }) => type),
    ).toEqual(['ProjectRegistered', 'ProjectsMerged']);
  });

  it('starts the history of a successor with the split that created it', async () => {
    const source = await registerProject(app);
    const { body } = await request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${source.id}/splits`)
      .send({
        successors: [aRegistration().sourceKey, ANOTHER_SOURCE_KEY].map(
          (key) => ({
            ...aRegistration(),
            sourceKey: undefined,
            sourceKeys: [key],
          }),
        ),
      });

    const response = await projectEvents(body.successors[0].id);

    expect(
      response.body.data.map(({ type }: { type: string }) => type),
    ).toEqual(['ProjectSplit']);
  });

  it.each([
    { field: 'after', query: { after: -1 } },
    { field: 'limit', query: { limit: 0 } },
    { field: 'limit', query: { limit: 201 } },
    { field: 'type', query: { type: 'ProjectsMerged' } },
  ])('rejects invalid pagination ($field)', async ({ field, query }) => {
    const project = await registerProject(app);

    const response = await projectEvents(project.id, query);

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      { field, messages: expect.arrayContaining([expect.any(String)]) },
    ]);
  });
});
