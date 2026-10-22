import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  ANOTHER_SOURCE_KEY,
  aRegistration,
  PROJECTS_PATH,
  registerProject,
} from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

const INITIAL_SOURCE_KEY = aRegistration().sourceKey;
const { system: VALID_SYSTEM, externalId: VALID_EXTERNAL_ID } =
  ANOTHER_SOURCE_KEY;

describe('GET /v1/projects?system=…&externalId=…', () => {
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

  function findProjects(query: Record<string, unknown>) {
    return request(app.getHttpServer()).get(PROJECTS_PATH).query(query);
  }

  it('finds the project that owns the source key', async () => {
    const project = await registerProject(app);
    await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );

    const response = await findProjects(INITIAL_SOURCE_KEY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [project] });
  });

  it('finds no project for a source key attached to none', async () => {
    await registerProject(app);

    const response = await findProjects(ANOTHER_SOURCE_KEY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [] });
  });

  it('finds the survivor, not the absorbed project, once a merge transferred the key', async () => {
    const survivor = await registerProject(app);
    const absorbed = await registerProject(
      app,
      aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
    );
    const merged = await request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${survivor.id}/merges`)
      .send({ absorbed: [absorbed.id] });

    const response = await findProjects(ANOTHER_SOURCE_KEY);

    expect(response.body).toEqual({ data: [merged.body] });
  });

  it('finds the successor that a split gave the key to', async () => {
    const source = await registerProject(app);
    const { body } = await request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${source.id}/splits`)
      .send({
        successors: [INITIAL_SOURCE_KEY, ANOTHER_SOURCE_KEY].map((key) => ({
          ...aRegistration(),
          sourceKey: undefined,
          sourceKeys: [key],
        })),
      });

    const response = await findProjects(INITIAL_SOURCE_KEY);

    expect(response.body).toEqual({ data: [body.successors[0]] });
  });

  it.each([
    {
      field: 'system',
      case: 'missing',
      query: { externalId: VALID_EXTERNAL_ID },
    },
    {
      field: 'externalId',
      case: 'missing',
      query: { system: VALID_SYSTEM },
    },
    {
      field: 'system',
      case: 'not a lowercase slug',
      query: { system: 'Guichet Unique', externalId: VALID_EXTERNAL_ID },
    },
    {
      field: 'externalId',
      case: 'containing a NUL character',
      query: { system: VALID_SYSTEM, externalId: 'GU-\u0000' },
    },
    {
      field: 'label',
      case: 'an unknown parameter',
      query: { ...ANOTHER_SOURCE_KEY, label: 'École' },
    },
  ])('rejects a search whose $field is $case', async ({ field, query }) => {
    const response = await findProjects(query);

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      { field, messages: expect.arrayContaining([expect.any(String)]) },
    ]);
  });
});
