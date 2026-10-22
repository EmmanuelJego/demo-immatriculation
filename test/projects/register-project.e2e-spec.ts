import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DATABASE } from '../../src/database/database.module.js';
import { registerProject } from '../../src/projects/domain/project.js';
import { contendWith } from '../support/concurrency.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';
import { EVENTS_PATH } from '../support/events.js';
import {
  ANOTHER_SOURCE_KEY,
  aRegistration,
  PROJECT_ID_FORMAT,
  PROJECTS_PATH,
  type Registration,
} from '../support/projects.js';

const MAX_LABEL_LENGTH = 200;
const MAX_SYSTEM_LENGTH = 50;
const MAX_EXTERNAL_ID_LENGTH = 100;

describe('POST /v1/projects', () => {
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

  it('registers a new project and returns it with a generated registration id', async () => {
    const registration = aRegistration();

    const response = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(registration);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.stringMatching(PROJECT_ID_FORMAT),
      label: registration.label,
      ownerSiren: registration.ownerSiren,
      status: 'ACTIVE',
      sourceKeys: [registration.sourceKey],
      createdAt: expect.any(String),
    });
    expect(new Date(response.body.createdAt).toISOString()).toBe(
      response.body.createdAt,
    );
  });

  it('locates the registered project', async () => {
    const response = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(aRegistration());

    expect(response.headers.location).toBe(
      `${PROJECTS_PATH}/${response.body.id}`,
    );
  });

  it('records the registration in the event log', async () => {
    const registration = aRegistration();

    const response = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(registration);

    expect(await eventLog()).toEqual([
      {
        sequence: expect.any(Number),
        type: 'ProjectRegistered',
        occurredAt: expect.any(String),
        projectIds: [response.body.id],
        payload: registration,
      },
    ]);
  });

  it('returns the existing project, without a new event, when the registration is replayed', async () => {
    const registration = aRegistration();
    const first = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(registration);
    const eventsAfterFirst = await eventLog();

    const replay = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(registration);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.location).toBe(first.headers.location);
    expect(await eventLog()).toEqual(eventsAfterFirst);
  });

  it('rejects, without a new event, a registered source key sent with other attributes', async () => {
    const registration = aRegistration();
    const first = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(registration);
    const eventsAfterFirst = await eventLog();

    const conflicting = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send({ ...registration, label: 'Construction d’un gymnase' });

    expect(conflicting.status).toBe(409);
    expect(conflicting.headers['content-type']).toMatch(
      /^application\/problem\+json/,
    );
    expect(conflicting.body).toEqual({
      type: 'urn:immatriculation:problem:source-key-already-registered',
      title: 'Conflict',
      status: 409,
      detail: `Source key ${registration.sourceKey.system}/${registration.sourceKey.externalId} is already registered for project ${first.body.id} with other attributes`,
    });
    expect(await eventLog()).toEqual(eventsAfterFirst);
  });

  it('registers a distinct project for another source key, even with the same attributes', async () => {
    const registration = aRegistration();
    const first = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(registration);

    const second = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send({
        ...registration,
        sourceKey: ANOTHER_SOURCE_KEY,
      });

    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
  });

  describe('when a concurrent registration of the same source key commits first', () => {
    const concurrentId = 'PRJ-AAAA-AAAA';

    function registerConcurrentlyThenPost(
      concurrent: Registration,
      posted: Registration,
    ): Promise<request.Response> {
      return contendWith(
        app.get(DATABASE),
        async ({ projects, events }) => {
          const registered = registerProject(concurrent, concurrentId);
          await projects.insert(registered.project);
          await events.append(registered.event);
        },
        () => request(app.getHttpServer()).post(PROJECTS_PATH).send(posted),
      );
    }

    it('returns the concurrently registered project for the same attributes', async () => {
      const registration = aRegistration();

      const response = await registerConcurrentlyThenPost(
        registration,
        registration,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(concurrentId);
      expect(await eventLog()).toHaveLength(1);
    });

    it('rejects the registration when its attributes differ', async () => {
      const registration = aRegistration();

      const response = await registerConcurrentlyThenPost(registration, {
        ...registration,
        label: 'Construction d’un gymnase',
      });

      expect(response.status).toBe(409);
      expect(response.body.type).toBe(
        'urn:immatriculation:problem:source-key-already-registered',
      );
      expect(await eventLog()).toHaveLength(1);
    });
  });

  it.each([
    { field: 'label', case: 'missing', body: { label: undefined } },
    { field: 'label', case: 'not a string', body: { label: 42 } },
    { field: 'label', case: 'blank', body: { label: '   ' } },
    {
      field: 'label',
      case: 'containing a NUL character',
      body: { label: 'École\u0000' },
    },
    {
      field: 'label',
      case: 'too long',
      body: { label: 'x'.repeat(MAX_LABEL_LENGTH + 1) },
    },
    { field: 'ownerSiren', case: 'missing', body: { ownerSiren: undefined } },
    { field: 'ownerSiren', case: '8 digits', body: { ownerSiren: '21310555' } },
    { field: 'ownerSiren', case: 'letters', body: { ownerSiren: '21310555A' } },
    {
      field: 'ownerSiren',
      case: 'a wrong check digit',
      body: { ownerSiren: '213105555' },
    },
    { field: 'sourceKey', case: 'missing', body: { sourceKey: undefined } },
    {
      field: 'sourceKey.system',
      case: 'not a lowercase slug',
      body: { sourceKey: { system: 'Dotations', externalId: 'DOS-1' } },
    },
    {
      field: 'sourceKey.system',
      case: 'too long',
      body: {
        sourceKey: {
          system: 'x'.repeat(MAX_SYSTEM_LENGTH + 1),
          externalId: 'DOS-1',
        },
      },
    },
    {
      field: 'sourceKey.externalId',
      case: 'empty',
      body: { sourceKey: { system: 'dotations', externalId: '' } },
    },
    {
      field: 'sourceKey.externalId',
      case: 'containing a NUL character',
      body: { sourceKey: { system: 'dotations', externalId: 'DOS-\u0000' } },
    },
    {
      field: 'sourceKey.externalId',
      case: 'too long',
      body: {
        sourceKey: {
          system: 'dotations',
          externalId: 'x'.repeat(MAX_EXTERNAL_ID_LENGTH + 1),
        },
      },
    },
    { field: 'priority', case: 'an unknown field', body: { priority: 1 } },
    {
      field: 'sourceKey.url',
      case: 'an unknown field',
      body: {
        sourceKey: {
          system: 'dotations',
          externalId: 'DOS-1',
          url: 'https://example.org',
        },
      },
    },
  ])(
    'rejects a registration whose $field is $case, without registering anything',
    async ({ field, body }) => {
      const response = await request(app.getHttpServer())
        .post(PROJECTS_PATH)
        .send({ ...aRegistration(), ...body });

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
      expect(await eventLog()).toEqual([]);
    },
  );

  it.each([
    { field: 'label', value: 'x'.repeat(MAX_LABEL_LENGTH) },
    { field: 'system', value: 'x'.repeat(MAX_SYSTEM_LENGTH) },
    { field: 'externalId', value: 'x'.repeat(MAX_EXTERNAL_ID_LENGTH) },
  ])('accepts a $field at its maximum length', async ({ field, value }) => {
    const registration = aRegistration();
    const body =
      field === 'label'
        ? { ...registration, label: value }
        : {
            ...registration,
            sourceKey: { ...registration.sourceKey, [field]: value },
          };

    const response = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(body);

    expect(response.status).toBe(201);
  });

  async function eventLog(): Promise<unknown[]> {
    const response = await request(app.getHttpServer()).get(EVENTS_PATH);
    return response.body.data;
  }
});
