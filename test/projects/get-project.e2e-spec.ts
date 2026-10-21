import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { aRegistration, PROJECTS_PATH } from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

describe('GET /v1/projects/{id}', () => {
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

  it('returns a registered project as it was registered', async () => {
    const registered = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(aRegistration());

    const response = await request(app.getHttpServer()).get(
      registered.headers.location,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(registered.body);
  });

  it.each([
    { case: 'an unknown id', id: 'PRJ-0000-0000' },
    { case: 'a malformed id', id: 'not-a-registration-id' },
    { case: 'an id with a NUL character', id: 'PRJ-\u0000' },
  ])('reports $case as a missing project', async ({ id }) => {
    const response = await request(app.getHttpServer()).get(
      `${PROJECTS_PATH}/${encodeURIComponent(id)}`,
    );

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(
      /^application\/problem\+json/,
    );
    expect(response.body).toEqual({
      type: 'urn:immatriculation:problem:project-not-found',
      title: 'Not Found',
      status: 404,
      detail: `Project ${id} does not exist`,
    });
  });
});
