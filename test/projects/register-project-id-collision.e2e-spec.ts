import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PROJECT_ID_GENERATOR } from '../../src/projects/application/register-project.js';
import { EVENTS_PATH } from '../support/events.js';
import {
  ANOTHER_SOURCE_KEY,
  aRegistration,
  PROJECTS_PATH,
} from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

const TAKEN_ID = 'PRJ-AAAA-AAAA';
const FREE_ID = 'PRJ-BBBB-BBBB';

describe('POST /v1/projects, when the generated id is already taken', () => {
  let app: INestApplication<App>;
  let generatedIds: string[];

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(PROJECT_ID_GENERATOR)
        .useValue(() => generatedIds.shift()),
    );
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerTakingTheId(): Promise<void> {
    const response = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(aRegistration());
    expect(response.status).toBe(201);
    expect(response.body.id).toBe(TAKEN_ID);
  }

  async function eventLog(): Promise<unknown[]> {
    const response = await request(app.getHttpServer()).get(EVENTS_PATH);
    return response.body.data;
  }

  it('draws a new id and registers the project with it', async () => {
    generatedIds = [TAKEN_ID, TAKEN_ID, FREE_ID];
    await registerTakingTheId();

    const response = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }));

    expect(response.status).toBe(201);
    expect(response.body.id).toBe(FREE_ID);
    expect(await eventLog()).toHaveLength(2);
  });

  it('gives up with a generic error when every attempt draws a taken id', async () => {
    generatedIds = [TAKEN_ID, TAKEN_ID, TAKEN_ID, TAKEN_ID];
    await registerTakingTheId();

    const response = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred',
    });
    expect(await eventLog()).toHaveLength(1);
  });
});
