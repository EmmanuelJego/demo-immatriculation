import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DATABASE } from '../../src/database/database.module.js';
import { contendWith } from '../support/concurrency.js';
import { eventLog } from '../support/events.js';
import {
  ANOTHER_SOURCE_KEY,
  aRegistration,
  PROJECTS_PATH,
  registerProject,
} from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

const THIRD_SOURCE_KEY = { system: 'aides-territoires', externalId: 'AT-7' };
const UNKNOWN_PROJECT_ID = 'PRJ-0000-0000';
const CONCURRENT_SOURCE_KEY = { system: 'dotations', externalId: 'CONCURRENT' };

describe('POST /v1/projects/{id}/merges', () => {
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

  function merge(survivorId: string, absorbed: string[]) {
    return postMerge(survivorId, { absorbed });
  }

  function postMerge(survivorId: string, body: object) {
    return request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${encodeURIComponent(survivorId)}/merges`)
      .send(body);
  }

  it('absorbs the projects and returns the survivor with all their source keys', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );

    const response = await merge(survivor.id, [absorbed.id]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...survivor,
      sourceKeys: [...survivor.sourceKeys, ANOTHER_SOURCE_KEY],
    });
    expect(response.headers['content-location']).toBe(
      `${PROJECTS_PATH}/${survivor.id}`,
    );
  });

  it('keeps the absorbed project readable, closed and pointing to the survivor', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    await merge(survivor.id, [absorbed.id]);

    const response = await request(app.getHttpServer()).get(
      `${PROJECTS_PATH}/${absorbed.id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...absorbed,
      status: 'MERGED',
      mergedInto: survivor.id,
      sourceKeys: [],
    });
  });

  it('keeps the transferred keys on the survivor', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    const merged = await merge(survivor.id, [absorbed.id]);

    const response = await request(app.getHttpServer()).get(
      `${PROJECTS_PATH}/${survivor.id}`,
    );

    expect(response.body).toEqual(merged.body);
  });

  it('records the merge in the event log', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );

    await merge(survivor.id, [absorbed.id]);

    expect(await eventLog(app)).toEqual([
      expect.objectContaining({ type: 'ProjectRegistered' }),
      expect.objectContaining({ type: 'ProjectRegistered' }),
      {
        sequence: expect.any(Number),
        type: 'ProjectsMerged',
        occurredAt: expect.any(String),
        projectIds: [survivor.id, absorbed.id],
        payload: {
          survivor: survivor.id,
          absorbed: [absorbed.id],
          transferredSourceKeys: [ANOTHER_SOURCE_KEY],
        },
      },
    ]);
  });

  it('absorbs several projects at once', async () => {
    const survivor = await registerProject(app);
    const first = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    const second = await registerProject(
      app,
      aRegistration({ sourceKey: THIRD_SOURCE_KEY }),
    );

    const response = await merge(survivor.id, [first.id, second.id]);

    expect(response.body.sourceKeys).toEqual([
      ...survivor.sourceKeys,
      ANOTHER_SOURCE_KEY,
      THIRD_SOURCE_KEY,
    ]);
    const [, , , event] = (await eventLog(app)) as { payload: unknown }[];
    expect(event.payload).toEqual({
      survivor: survivor.id,
      absorbed: [first.id, second.id],
      transferredSourceKeys: [ANOTHER_SOURCE_KEY, THIRD_SOURCE_KEY],
    });
  });

  it('returns the survivor unchanged, without a new event, when the merge is replayed', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    const first = await merge(survivor.id, [absorbed.id]);
    const eventsAfterFirst = await eventLog(app);

    const replay = await merge(survivor.id, [absorbed.id]);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await eventLog(app)).toEqual(eventsAfterFirst);
  });

  it('absorbs only the projects not yet merged into the survivor', async () => {
    const survivor = await registerProject(app);
    const alreadyAbsorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: THIRD_SOURCE_KEY }),
    );
    await merge(survivor.id, [alreadyAbsorbed.id]);

    const response = await merge(survivor.id, [
      alreadyAbsorbed.id,
      absorbed.id,
    ]);

    expect(response.status).toBe(200);
    expect(response.body.sourceKeys).toContainEqual(THIRD_SOURCE_KEY);
    const events = (await eventLog(app)) as { payload: unknown }[];
    expect(events.at(-1)?.payload).toEqual({
      survivor: survivor.id,
      absorbed: [absorbed.id],
      transferredSourceKeys: [THIRD_SOURCE_KEY],
    });
  });

  it.each([
    { case: 'an unknown project', id: UNKNOWN_PROJECT_ID },
    { case: 'a malformed id', id: 'not-a-registration-id' },
    { case: 'an id with a NUL character', id: 'PRJ-\u0000' },
  ])('reports $case as a missing survivor', async ({ id }) => {
    const absorbed = await registerProject(app);

    const response = await merge(id, [absorbed.id]);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:project-not-found',
      title: 'Not Found',
      status: 404,
      detail: `Project ${id} does not exist`,
    });
  });

  it('rejects a survivor among the absorbed projects', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );

    const response = await merge(survivor.id, [absorbed.id, survivor.id]);

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:survivor-among-absorbed',
      title: 'Unprocessable Entity',
      status: 422,
      detail: `Project ${survivor.id} cannot absorb itself`,
    });
  });

  it('rejects, without merging anything, an unknown absorbed project', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    const eventsBefore = await eventLog(app);

    const response = await merge(survivor.id, [
      absorbed.id,
      UNKNOWN_PROJECT_ID,
    ]);

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:absorbed-project-not-found',
      title: 'Unprocessable Entity',
      status: 422,
      detail: `Absorbed project ${UNKNOWN_PROJECT_ID} does not exist`,
    });
    expect(await eventLog(app)).toEqual(eventsBefore);
  });

  it('reports an unknown absorbed project before a closed survivor', async () => {
    const survivor = await registerProject(app);
    const other = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    await merge(other.id, [survivor.id]);

    const response = await merge(survivor.id, [UNKNOWN_PROJECT_ID]);

    expect(response.status).toBe(422);
    expect(response.body.type).toBe(
      'urn:immatriculation:problem:absorbed-project-not-found',
    );
  });

  it('accepts up to 100 absorbed projects', async () => {
    const survivor = await registerProject(app);
    const absorbed = Array.from(
      { length: 100 },
      (_, index) => `PRJ-0000-${String(index + 1).padStart(4, '0')}`,
    );

    const response = await merge(survivor.id, absorbed);

    // Past validation: the first of these unknown projects is reported.
    expect(response.status).toBe(422);
    expect(response.body.detail).toBe(
      `Absorbed project ${absorbed[0]} does not exist`,
    );
  });

  it('rejects, without a new event, a merge into a survivor absorbed meanwhile', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    const other = await registerProject(
      app,
      aRegistration({ sourceKey: THIRD_SOURCE_KEY }),
    );
    await merge(other.id, [survivor.id]);
    const eventsBefore = await eventLog(app);

    const response = await merge(survivor.id, [absorbed.id]);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:project-not-active',
      title: 'Conflict',
      status: 409,
      detail: `Project ${survivor.id} is MERGED and no longer accepts changes`,
    });
    expect(await eventLog(app)).toEqual(eventsBefore);
  });

  it('rejects, without merging anything, a project already merged into another one', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    const other = await registerProject(
      app,
      aRegistration({ sourceKey: THIRD_SOURCE_KEY }),
    );
    await merge(other.id, [absorbed.id]);
    const eventsBefore = await eventLog(app);

    const response = await merge(survivor.id, [absorbed.id]);

    expect(response.status).toBe(409);
    expect(response.body.detail).toBe(
      `Project ${absorbed.id} is MERGED and no longer accepts changes`,
    );
    expect(await eventLog(app)).toEqual(eventsBefore);
  });

  it.each([
    { case: 'missing', body: {} },
    { case: 'not an array', body: { absorbed: 'PRJ-AB12-CD34' } },
    { case: 'empty', body: { absorbed: [] } },
    { case: 'holding a malformed id', body: { absorbed: ['PRJ-AB12-CD3I'] } },
    {
      case: 'holding the same id twice',
      body: { absorbed: ['PRJ-AB12-CD34', 'PRJ-AB12-CD34'] },
    },
    {
      case: 'longer than 100 ids',
      body: {
        absorbed: Array.from(
          { length: 101 },
          (_, index) => `PRJ-0000-${String(index).padStart(4, '0')}`,
        ),
      },
    },
  ])(
    'rejects a merge whose absorbed list is $case, without merging anything',
    async ({ body }) => {
      const survivor = await registerProject(app);
      const eventsBefore = await eventLog(app);

      const response = await postMerge(survivor.id, body);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        {
          field: 'absorbed',
          messages: expect.arrayContaining([expect.any(String)]),
        },
      ]);
      expect(await eventLog(app)).toEqual(eventsBefore);
    },
  );

  it('rejects a merge request with an unknown field', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );

    const response = await postMerge(survivor.id, {
      absorbed: [absorbed.id],
      survivor: survivor.id,
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      {
        field: 'survivor',
        messages: expect.arrayContaining([expect.any(String)]),
      },
    ]);
  });

  describe('once merged, the source keys of an absorbed project', () => {
    it('replay its registration, which returns it with its link to the survivor', async () => {
      const survivor = await registerProject(app);
      const registration = aRegistration({
        label: 'Construction d’un gymnase',
        sourceKey: ANOTHER_SOURCE_KEY,
      });
      const absorbed = await registerProject(app, registration);
      await merge(survivor.id, [absorbed.id]);
      const eventsBefore = await eventLog(app);

      const response = await request(app.getHttpServer())
        .post(PROJECTS_PATH)
        .send(registration);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ...absorbed,
        status: 'MERGED',
        mergedInto: survivor.id,
        sourceKeys: [],
      });
      expect(await eventLog(app)).toEqual(eventsBefore);
    });

    it('belong to the survivor for attachments', async () => {
      const survivor = await registerProject(app);
      const absorbed = await registerProject(
        app,
        aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
      );
      const other = await registerProject(
        app,
        aRegistration({ sourceKey: THIRD_SOURCE_KEY }),
      );
      await merge(survivor.id, [absorbed.id]);

      const response = await request(app.getHttpServer())
        .post(`${PROJECTS_PATH}/${other.id}/source-keys`)
        .send(ANOTHER_SOURCE_KEY);

      expect(response.status).toBe(409);
      expect(response.body.detail).toBe(
        `Source key ${ANOTHER_SOURCE_KEY.system}/${ANOTHER_SOURCE_KEY.externalId} belongs to project ${survivor.id}`,
      );
    });
  });

  describe('when a concurrent command on the absorbed project commits first', () => {
    it('rejects absorbing a project that a concurrent merge absorbed', async () => {
      const survivor = await registerProject(app);
      const absorbed = await registerProject(
        app,
        aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
      );
      const other = await registerProject(
        app,
        aRegistration({ sourceKey: THIRD_SOURCE_KEY }),
      );

      const response = await contendWith(
        app.get(DATABASE),
        async ({ projects }) => {
          await projects.findManyByIdForUpdate([other.id, absorbed.id]);
          await projects.mergeInto(other.id, [absorbed.id]);
        },
        () => merge(survivor.id, [absorbed.id]),
      );

      expect(response.status).toBe(409);
      expect(response.body.type).toBe(
        'urn:immatriculation:problem:project-not-active',
      );
    });

    it('transfers a key attached concurrently to the absorbed project', async () => {
      const survivor = await registerProject(app);
      const absorbed = await registerProject(
        app,
        aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
      );

      const response = await contendWith(
        app.get(DATABASE),
        // As AttachSourceKey does: lock the project, then attach the key.
        async ({ projects }) => {
          await projects.findByIdForUpdate(absorbed.id);
          await projects.attachSourceKey(absorbed.id, CONCURRENT_SOURCE_KEY);
        },
        () => merge(survivor.id, [absorbed.id]),
      );

      expect(response.status).toBe(200);
      expect(response.body.sourceKeys).toContainEqual(CONCURRENT_SOURCE_KEY);
      const events = (await eventLog(app)) as { payload: unknown }[];
      expect(events.at(-1)?.payload).toEqual({
        survivor: survivor.id,
        absorbed: [absorbed.id],
        transferredSourceKeys: [ANOTHER_SOURCE_KEY, CONCURRENT_SOURCE_KEY],
      });
    });

    it('rejects attaching a key to a project that a concurrent merge absorbed', async () => {
      const survivor = await registerProject(app);
      const absorbed = await registerProject(
        app,
        aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
      );

      const response = await contendWith(
        app.get(DATABASE),
        async ({ projects }) => {
          await projects.findManyByIdForUpdate([survivor.id, absorbed.id]);
          await projects.mergeInto(survivor.id, [absorbed.id]);
        },
        () =>
          request(app.getHttpServer())
            .post(`${PROJECTS_PATH}/${absorbed.id}/source-keys`)
            .send(CONCURRENT_SOURCE_KEY),
      );

      expect(response.status).toBe(409);
      expect(response.body.type).toBe(
        'urn:immatriculation:problem:project-not-active',
      );
    });
  });
});
