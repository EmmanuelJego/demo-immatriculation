import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DATABASE, type Database } from '../../src/database/database.module.js';
import { DrizzleUnitOfWork } from '../../src/projects/infrastructure/drizzle-unit-of-work.js';
import { contendWith } from '../support/concurrency.js';
import { aRegistration, PROJECTS_PATH } from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

describe('Project repository', () => {
  let app: INestApplication<App>;
  let db: Database;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DATABASE);
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('findByIdForUpdate', () => {
    it('makes a concurrent command on the same project wait until the end of the transaction', async () => {
      const { body: project } = await request(app.getHttpServer())
        .post(PROJECTS_PATH)
        .send(aRegistration());

      // contendWith fails unless the contender gets blocked on a lock.
      const lockedLater = await contendWith(
        db,
        async ({ projects }) => {
          await projects.findByIdForUpdate(project.id);
        },
        () =>
          new DrizzleUnitOfWork(db).run(({ projects }) =>
            projects.findByIdForUpdate(project.id),
          ),
      );

      expect(lockedLater?.id).toBe(project.id);
    });
  });
});
