import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { eq } from 'drizzle-orm';
import { DATABASE, type Database } from '../../src/database/database.module.js';
import { projects } from '../../src/database/schema.js';
import { contendWith } from '../support/concurrency.js';
import { EVENTS_PATH } from '../support/events.js';
import {
  ANOTHER_SOURCE_KEY,
  aRegistration,
  PROJECTS_PATH,
} from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

// Initial key of the project that wins the concurrent attachment.
const OTHER_PROJECT_SOURCE_KEY = { system: 'dotations', externalId: 'B' };

describe('POST /v1/projects/{id}/source-keys', () => {
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

  async function registerProject(registration = aRegistration()) {
    const response = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(registration);
    expect(response.status).toBe(201);
    return response.body;
  }

  function attach(projectId: string, sourceKey: object) {
    return request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}/source-keys`)
      .send(sourceKey);
  }

  it('attaches a new source key and returns the project with all its keys', async () => {
    const registration = aRegistration();
    const project = await registerProject(registration);

    const response = await attach(project.id, ANOTHER_SOURCE_KEY);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ...project,
      sourceKeys: [registration.sourceKey, ANOTHER_SOURCE_KEY],
    });
    expect(response.headers['content-location']).toBe(
      `${PROJECTS_PATH}/${project.id}`,
    );
  });

  it('keeps the attached key on the project', async () => {
    const project = await registerProject();
    const attached = await attach(project.id, ANOTHER_SOURCE_KEY);

    const response = await request(app.getHttpServer()).get(
      `${PROJECTS_PATH}/${project.id}`,
    );

    expect(response.body).toEqual(attached.body);
  });

  it('records the attachment in the event log', async () => {
    const project = await registerProject();

    await attach(project.id, ANOTHER_SOURCE_KEY);

    expect(await eventLog()).toEqual([
      expect.objectContaining({ type: 'ProjectRegistered' }),
      {
        sequence: expect.any(Number),
        type: 'SourceKeyAttached',
        occurredAt: expect.any(String),
        projectIds: [project.id],
        payload: { sourceKey: ANOTHER_SOURCE_KEY },
      },
    ]);
  });

  it('returns the project unchanged, without a new event, when the attachment is replayed', async () => {
    const project = await registerProject();
    const first = await attach(project.id, ANOTHER_SOURCE_KEY);
    const eventsAfterFirst = await eventLog();

    const replay = await attach(project.id, ANOTHER_SOURCE_KEY);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await eventLog()).toEqual(eventsAfterFirst);
  });

  it('rejects, without a new event, a key that belongs to another project', async () => {
    const project = await registerProject();
    const other = await registerProject(
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    const eventsBefore = await eventLog();

    const response = await attach(project.id, ANOTHER_SOURCE_KEY);

    expect(response.status).toBe(409);
    expect(response.headers['content-type']).toMatch(
      /^application\/problem\+json/,
    );
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:source-key-owned-by-another-project',
      title: 'Conflict',
      status: 409,
      detail: `Source key ${ANOTHER_SOURCE_KEY.system}/${ANOTHER_SOURCE_KEY.externalId} belongs to project ${other.id}`,
    });
    expect(await eventLog()).toEqual(eventsBefore);
  });

  it.each([
    { case: 'an unknown project', id: 'PRJ-0000-0000' },
    { case: 'a malformed id', id: 'not-a-registration-id' },
    { case: 'an id with a NUL character', id: 'PRJ-\u0000' },
  ])('reports $case as a missing project', async ({ id }) => {
    const response = await attach(id, ANOTHER_SOURCE_KEY);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:project-not-found',
      title: 'Not Found',
      status: 404,
      detail: `Project ${id} does not exist`,
    });
  });

  it.each([
    { field: 'system', case: 'missing', key: { externalId: 'GU-42' } },
    {
      field: 'system',
      case: 'not a lowercase slug',
      key: { system: 'Guichet Unique', externalId: 'GU-42' },
    },
    {
      field: 'externalId',
      case: 'empty',
      key: { system: 'guichet-unique', externalId: '' },
    },
    {
      field: 'externalId',
      case: 'containing a NUL character',
      key: { system: 'guichet-unique', externalId: 'GU-\u0000' },
    },
    {
      field: 'url',
      case: 'an unknown field',
      key: { ...ANOTHER_SOURCE_KEY, url: 'https://example.org' },
    },
  ])(
    'rejects a key whose $field is $case, without attaching anything',
    async ({ field, key }) => {
      const project = await registerProject();
      const eventsBefore = await eventLog();

      const response = await attach(project.id, key);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field, messages: expect.arrayContaining([expect.any(String)]) },
      ]);
      expect(await eventLog()).toEqual(eventsBefore);
    },
  );

  describe('once attached, the key identifies the project for registrations', () => {
    it('replays the registration of the project with the same attributes', async () => {
      const registration = aRegistration();
      const project = await registerProject(registration);
      await attach(project.id, ANOTHER_SOURCE_KEY);

      const response = await request(app.getHttpServer())
        .post(PROJECTS_PATH)
        .send({ ...registration, sourceKey: ANOTHER_SOURCE_KEY });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(project.id);
    });

    it('rejects a registration with other attributes', async () => {
      const registration = aRegistration();
      const project = await registerProject(registration);
      await attach(project.id, ANOTHER_SOURCE_KEY);

      const response = await request(app.getHttpServer())
        .post(PROJECTS_PATH)
        .send({
          ...registration,
          label: 'Construction d’un gymnase',
          sourceKey: ANOTHER_SOURCE_KEY,
        });

      expect(response.status).toBe(409);
    });
  });

  describe('on a project that is no longer active', () => {
    async function closeProject(id: string): Promise<void> {
      await app
        .get<Database>(DATABASE)
        .update(projects)
        .set({ status: 'MERGED' })
        .where(eq(projects.id, id));
    }

    it('rejects, without a new event, the attachment of a new key', async () => {
      const project = await registerProject();
      await closeProject(project.id);
      const eventsBefore = await eventLog();

      const response = await attach(project.id, ANOTHER_SOURCE_KEY);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        type: 'urn:immatriculation:problem:project-not-active',
        title: 'Conflict',
        status: 409,
        detail: `Project ${project.id} is MERGED and no longer accepts changes`,
      });
      expect(await eventLog()).toEqual(eventsBefore);
    });

    it('rejects even a key the project already has', async () => {
      const registration = aRegistration();
      const project = await registerProject(registration);
      await closeProject(project.id);

      const response = await attach(project.id, registration.sourceKey);

      expect(response.status).toBe(409);
      expect(response.body.type).toBe(
        'urn:immatriculation:problem:project-not-active',
      );
    });
  });

  describe('when a concurrent attachment of the same key commits first', () => {
    it('rejects the attachment to another project', async () => {
      const project = await registerProject();
      const other = await registerProject(
        aRegistration({ sourceKey: OTHER_PROJECT_SOURCE_KEY }),
      );

      const response = await contendWith(
        app.get(DATABASE),
        ({ projects }) =>
          projects.attachSourceKey(other.id, ANOTHER_SOURCE_KEY),
        () => attach(project.id, ANOTHER_SOURCE_KEY),
      );

      expect(response.status).toBe(409);
      expect(response.body.type).toBe(
        'urn:immatriculation:problem:source-key-owned-by-another-project',
      );
    });

    it('replays the attachment to the same project', async () => {
      const project = await registerProject();

      const response = await contendWith(
        app.get(DATABASE),
        ({ projects }) =>
          projects.attachSourceKey(project.id, ANOTHER_SOURCE_KEY),
        () => attach(project.id, ANOTHER_SOURCE_KEY),
      );

      expect(response.status).toBe(200);
      expect(response.body.sourceKeys).toContainEqual(ANOTHER_SOURCE_KEY);
    });
  });

  async function eventLog(): Promise<unknown[]> {
    const response = await request(app.getHttpServer()).get(EVENTS_PATH);
    return response.body.data;
  }
});
