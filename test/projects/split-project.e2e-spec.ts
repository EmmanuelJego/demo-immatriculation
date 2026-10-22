import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DATABASE } from '../../src/database/database.module.js';
import { contendWith } from '../support/concurrency.js';
import { eventLog } from '../support/events.js';
import {
  ANOTHER_SOURCE_KEY,
  aRegistration,
  PROJECT_ID_FORMAT,
  PROJECTS_PATH,
  registerProject,
  TOULOUSE_SIREN,
} from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

const INITIAL_SOURCE_KEY = aRegistration().sourceKey;
const FRESH_SOURCE_KEY = { system: 'aides-territoires', externalId: 'AT-7' };
const OTHER_PROJECT_SOURCE_KEY = { system: 'dotations', externalId: 'OTHER' };
const CONCURRENT_SUCCESSOR_IDS = ['PRJ-0000-0001', 'PRJ-0000-0002'];
const SUCCESSORS = [
  {
    label: 'Rénovation de l’école, tranche 1',
    ownerSiren: TOULOUSE_SIREN,
    sourceKeys: [INITIAL_SOURCE_KEY],
  },
  {
    label: 'Rénovation de l’école, tranche 2',
    ownerSiren: TOULOUSE_SIREN,
    sourceKeys: [ANOTHER_SOURCE_KEY, FRESH_SOURCE_KEY],
  },
];

describe('POST /v1/projects/{id}/splits', () => {
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

  function split(sourceId: string, successors: object[]) {
    return postSplit(sourceId, { successors });
  }

  function postSplit(sourceId: string, body: object) {
    return request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${encodeURIComponent(sourceId)}/splits`)
      .send(body);
  }

  // A project holding the keys of INITIAL_SOURCE_KEY and ANOTHER_SOURCE_KEY.
  async function registerSource() {
    const project = await registerProject(app);
    const attached = await request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${project.id}/source-keys`)
      .send(ANOTHER_SOURCE_KEY);
    expect(attached.status).toBe(201);
    return attached.body;
  }

  it('creates the successors with their share of the keys, and closes the source', async () => {
    const source = await registerSource();

    const response = await split(source.id, SUCCESSORS);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      source: {
        ...source,
        status: 'SPLIT',
        splitInto: response.body.successors.map(({ id }: { id: string }) => id),
        sourceKeys: [],
      },
      successors: SUCCESSORS.map((successor) => ({
        id: expect.stringMatching(PROJECT_ID_FORMAT),
        ...successor,
        status: 'ACTIVE',
        mergedInto: null,
        splitInto: null,
        createdAt: expect.any(String),
      })),
    });
  });

  it('keeps the source and the successors as the split returned them', async () => {
    const source = await registerSource();
    const { body } = await split(source.id, SUCCESSORS);

    const read = (id: string) =>
      request(app.getHttpServer()).get(`${PROJECTS_PATH}/${id}`);

    expect((await read(source.id)).body).toEqual(body.source);
    for (const successor of body.successors) {
      expect((await read(successor.id)).body).toEqual(successor);
    }
  });

  it('records the split in the event log', async () => {
    const source = await registerSource();

    const { body } = await split(source.id, SUCCESSORS);

    const successorIds = body.successors.map(({ id }: { id: string }) => id);
    expect((await eventLog(app)).at(-1)).toEqual({
      sequence: expect.any(Number),
      type: 'ProjectSplit',
      occurredAt: expect.any(String),
      projectIds: [source.id, ...successorIds],
      payload: {
        source: source.id,
        successors: SUCCESSORS.map((successor, index) => ({
          id: successorIds[index],
          ...successor,
        })),
      },
    });
  });

  it('returns the existing successors, without a new event, when the split is replayed', async () => {
    const source = await registerSource();
    const first = await split(source.id, SUCCESSORS);
    const eventsAfterFirst = await eventLog(app);

    const replay = await split(source.id, [...SUCCESSORS].reverse());

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await eventLog(app)).toEqual(eventsAfterFirst);
  });

  it('rejects, without a new event, a replay with another allocation of the keys', async () => {
    const source = await registerSource();
    await split(source.id, SUCCESSORS);
    const eventsBefore = await eventLog(app);
    const [first, second] = SUCCESSORS;

    const response = await split(source.id, [
      { ...first, sourceKeys: [INITIAL_SOURCE_KEY, ANOTHER_SOURCE_KEY] },
      { ...second, sourceKeys: [FRESH_SOURCE_KEY] },
    ]);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:project-already-split',
      title: 'Conflict',
      status: 409,
      detail: `Project ${source.id} is already split into other successors`,
    });
    expect(await eventLog(app)).toEqual(eventsBefore);
  });

  describe('after a split, registering again', () => {
    it('with the key of the source returns the source, with its links to the successors', async () => {
      const source = await registerSource();
      const { body } = await split(source.id, SUCCESSORS);

      const response = await request(app.getHttpServer())
        .post(PROJECTS_PATH)
        .send(aRegistration());

      expect(response.status).toBe(200);
      expect(response.body).toEqual(body.source);
    });

    it('with a new key of a successor returns that successor', async () => {
      const source = await registerSource();
      const { body } = await split(source.id, SUCCESSORS);
      const [, second] = SUCCESSORS;

      const response = await request(app.getHttpServer())
        .post(PROJECTS_PATH)
        .send({
          ...second,
          sourceKeys: undefined,
          sourceKey: FRESH_SOURCE_KEY,
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(body.successors[1]);
    });
  });

  it.each([
    { case: 'an unknown project', id: 'PRJ-0000-0000' },
    { case: 'a malformed id', id: 'not-a-registration-id' },
    { case: 'an id with a NUL character', id: 'PRJ-\u0000' },
  ])('reports $case as a missing source', async ({ id }) => {
    const response = await split(id, SUCCESSORS);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:project-not-found',
      title: 'Not Found',
      status: 404,
      detail: `Project ${id} does not exist`,
    });
  });

  it('rejects, without splitting anything, a key allocated to two successors', async () => {
    const source = await registerSource();
    const eventsBefore = await eventLog(app);
    const [first, second] = SUCCESSORS;

    const response = await split(source.id, [
      first,
      { ...second, sourceKeys: [...second.sourceKeys, INITIAL_SOURCE_KEY] },
    ]);

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:source-key-allocated-twice',
      title: 'Unprocessable Entity',
      status: 422,
      detail: `Source key ${INITIAL_SOURCE_KEY.system}/${INITIAL_SOURCE_KEY.externalId} is allocated to more than one successor`,
    });
    expect(await eventLog(app)).toEqual(eventsBefore);
  });

  it('rejects a key listed twice by the same successor', async () => {
    const source = await registerSource();
    const [first, second] = SUCCESSORS;

    const response = await split(source.id, [
      { ...first, sourceKeys: [INITIAL_SOURCE_KEY, INITIAL_SOURCE_KEY] },
      second,
    ]);

    expect(response.status).toBe(422);
    expect(response.body.type).toBe(
      'urn:immatriculation:problem:source-key-allocated-twice',
    );
  });

  it('rejects, without splitting anything, a key of the source allocated to no successor', async () => {
    const source = await registerSource();
    const eventsBefore = await eventLog(app);
    const [first, second] = SUCCESSORS;

    const response = await split(source.id, [
      first,
      { ...second, sourceKeys: [FRESH_SOURCE_KEY] },
    ]);

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:source-key-not-allocated',
      title: 'Unprocessable Entity',
      status: 422,
      detail: `Source key ${ANOTHER_SOURCE_KEY.system}/${ANOTHER_SOURCE_KEY.externalId} of project ${source.id} is allocated to no successor`,
    });
    expect(await eventLog(app)).toEqual(eventsBefore);
  });

  it('rejects, without splitting anything, a new key that belongs to another project', async () => {
    const source = await registerSource();
    const other = await registerProject(
      app,
      aRegistration({ sourceKey: OTHER_PROJECT_SOURCE_KEY }),
    );
    const eventsBefore = await eventLog(app);
    const [first, second] = SUCCESSORS;

    const response = await split(source.id, [
      first,
      { ...second, sourceKeys: [ANOTHER_SOURCE_KEY, OTHER_PROJECT_SOURCE_KEY] },
    ]);

    expect(response.status).toBe(409);
    expect(response.body.detail).toBe(
      `Source key ${OTHER_PROJECT_SOURCE_KEY.system}/${OTHER_PROJECT_SOURCE_KEY.externalId} belongs to project ${other.id}`,
    );
    expect(await eventLog(app)).toEqual(eventsBefore);
  });

  it('rejects the split of a project absorbed by a merge', async () => {
    const source = await registerSource();
    const survivor = await registerProject(
      app,
      aRegistration({ sourceKey: OTHER_PROJECT_SOURCE_KEY }),
    );
    await request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${survivor.id}/merges`)
      .send({ absorbed: [source.id] });

    const response = await split(source.id, SUCCESSORS);

    expect(response.status).toBe(409);
    expect(response.body.detail).toBe(
      `Project ${source.id} is MERGED and no longer accepts changes`,
    );
  });

  it.each([
    { field: 'successors', case: 'missing', body: {} },
    {
      field: 'successors',
      case: 'a single successor',
      body: { successors: [SUCCESSORS[0]] },
    },
    {
      field: 'successors',
      case: 'more than 20 successors',
      body: { successors: Array.from({ length: 21 }, () => SUCCESSORS[0]) },
    },
    {
      field: 'successors.1.sourceKeys',
      case: 'a successor without keys',
      body: {
        successors: [SUCCESSORS[0], { ...SUCCESSORS[1], sourceKeys: [] }],
      },
    },
    {
      field: 'successors.1.label',
      case: 'a successor without label',
      body: {
        successors: [SUCCESSORS[0], { ...SUCCESSORS[1], label: undefined }],
      },
    },
    {
      field: 'successors.0.ownerSiren',
      case: 'a successor with an invalid SIREN',
      body: {
        successors: [
          { ...SUCCESSORS[0], ownerSiren: '213105555' },
          SUCCESSORS[1],
        ],
      },
    },
    {
      field: 'successors.0.sourceKeys.0.system',
      case: 'a key with an invalid system',
      body: {
        successors: [
          {
            ...SUCCESSORS[0],
            sourceKeys: [{ system: 'Dotations', externalId: 'X' }],
          },
          SUCCESSORS[1],
        ],
      },
    },
    {
      field: 'successors.0.sourceKeys.0.externalId',
      case: 'a key with a NUL character',
      body: {
        successors: [
          {
            ...SUCCESSORS[0],
            sourceKeys: [{ system: 'dotations', externalId: 'X-\u0000' }],
          },
          SUCCESSORS[1],
        ],
      },
    },
    {
      field: 'successors.0.status',
      case: 'a successor with an unknown field',
      body: {
        successors: [{ ...SUCCESSORS[0], status: 'ACTIVE' }, SUCCESSORS[1]],
      },
    },
  ])(
    'rejects a split request with $case, without splitting anything',
    async ({ field, body }) => {
      const source = await registerSource();
      const eventsBefore = await eventLog(app);

      const response = await postSplit(source.id, body);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field, messages: expect.arrayContaining([expect.any(String)]) },
      ]);
      expect(await eventLog(app)).toEqual(eventsBefore);
    },
  );

  describe('once split, the source', () => {
    it('rejects the attachment of a key', async () => {
      const source = await registerSource();
      await split(source.id, SUCCESSORS);

      const response = await request(app.getHttpServer())
        .post(`${PROJECTS_PATH}/${source.id}/source-keys`)
        .send(OTHER_PROJECT_SOURCE_KEY);

      expect(response.status).toBe(409);
      expect(response.body.detail).toBe(
        `Project ${source.id} is SPLIT and no longer accepts changes`,
      );
    });

    it('cannot be absorbed by a merge', async () => {
      const source = await registerSource();
      await split(source.id, SUCCESSORS);
      const survivor = await registerProject(
        app,
        aRegistration({ sourceKey: OTHER_PROJECT_SOURCE_KEY }),
      );

      const response = await request(app.getHttpServer())
        .post(`${PROJECTS_PATH}/${survivor.id}/merges`)
        .send({ absorbed: [source.id] });

      expect(response.status).toBe(409);
      expect(response.body.detail).toBe(
        `Project ${source.id} is SPLIT and no longer accepts changes`,
      );
    });
  });

  describe('when a concurrent command commits first', () => {
    it('rejects a new key that a concurrent attachment gave to another project', async () => {
      const source = await registerSource();
      const other = await registerProject(
        app,
        aRegistration({ sourceKey: OTHER_PROJECT_SOURCE_KEY }),
      );

      const response = await contendWith(
        app.get(DATABASE),
        async ({ projects }) => {
          await projects.findByIdForUpdate(other.id);
          await projects.attachSourceKey(other.id, FRESH_SOURCE_KEY);
        },
        () => split(source.id, SUCCESSORS),
      );

      expect(response.status).toBe(409);
      expect(response.body.detail).toBe(
        `Source key ${FRESH_SOURCE_KEY.system}/${FRESH_SOURCE_KEY.externalId} belongs to project ${other.id}`,
      );
    });

    it('rejects the split of a source that a concurrent merge absorbed', async () => {
      const source = await registerSource();
      const survivor = await registerProject(
        app,
        aRegistration({ sourceKey: OTHER_PROJECT_SOURCE_KEY }),
      );

      const response = await contendWith(
        app.get(DATABASE),
        async ({ projects }) => {
          await projects.findManyByIdForUpdate([survivor.id, source.id]);
          await projects.mergeInto(survivor.id, [source.id]);
        },
        () => split(source.id, SUCCESSORS),
      );

      expect(response.status).toBe(409);
      expect(response.body.detail).toBe(
        `Project ${source.id} is MERGED and no longer accepts changes`,
      );
    });

    it('replays the same split, committed concurrently', async () => {
      const source = await registerSource();
      const successorIds = CONCURRENT_SUCCESSOR_IDS;

      const response = await contendWith(
        app.get(DATABASE),
        async ({ projects }) => {
          await projects.findByIdForUpdate(source.id);
          await projects.split(
            source.id,
            SUCCESSORS.map((successor, index) => ({
              id: successorIds[index],
              ...successor,
              status: 'ACTIVE',
              mergedInto: null,
              splitInto: null,
            })),
          );
        },
        () => split(source.id, SUCCESSORS),
      );

      expect(response.status).toBe(200);
      expect(response.body.source.splitInto).toEqual(successorIds);
    });
  });
});
