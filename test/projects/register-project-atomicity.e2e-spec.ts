import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DATABASE, type Database } from '../../src/database/database.module.js';
import {
  UNIT_OF_WORK,
  type RegistryTransaction,
  type UnitOfWork,
} from '../../src/projects/application/unit-of-work.js';
import { registerProject } from '../../src/projects/domain/project.js';
import { DrizzleProjectRepository } from '../../src/projects/infrastructure/drizzle-project-repository.js';
import { DrizzleUnitOfWork } from '../../src/projects/infrastructure/drizzle-unit-of-work.js';
import {
  ANOTHER_SOURCE_KEY,
  aRegistration,
  PROJECTS_PATH,
} from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

// The real unit of work, except that writing to the event log fails, as if
// the event could not be stored after the project was.
class FailingEventLogUnitOfWork implements UnitOfWork {
  private readonly inner: DrizzleUnitOfWork;

  constructor(db: Database) {
    this.inner = new DrizzleUnitOfWork(db);
  }

  run<T>(work: (tx: RegistryTransaction) => Promise<T>): Promise<T> {
    return this.inner.run((tx) =>
      work({
        ...tx,
        events: {
          append: () => Promise.reject(new Error('event log unavailable')),
        },
      }),
    );
  }
}

const SOURCE_ID = 'PRJ-AAAA-AAAA';

describe('Commands, when the event cannot be recorded', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(UNIT_OF_WORK).useFactory({
        factory: (db: Database) => new FailingEventLogUnitOfWork(db),
        inject: [DATABASE],
      }),
    );
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers nothing: no project without its event', async () => {
    const registration = aRegistration();

    const response = await request(app.getHttpServer())
      .post(PROJECTS_PATH)
      .send(registration);

    expect(response.status).toBe(500);
    const repository = new DrizzleProjectRepository(app.get(DATABASE));
    expect(
      await repository.findSourceKeyOrigin(registration.sourceKey),
    ).toBeNull();
  });

  it('splits nothing: no successor without the event', async () => {
    const registration = aRegistration();
    const repository = new DrizzleProjectRepository(app.get(DATABASE));
    // Stored without the API, whose registration would fail as well.
    await repository.insert(registerProject(registration, SOURCE_ID).project);

    const response = await request(app.getHttpServer())
      .post(`${PROJECTS_PATH}/${SOURCE_ID}/splits`)
      .send({
        successors: [registration.sourceKey, ANOTHER_SOURCE_KEY].map((key) => ({
          label: registration.label,
          ownerSiren: registration.ownerSiren,
          sourceKeys: [key],
        })),
      });

    expect(response.status).toBe(500);
    expect(await repository.findById(SOURCE_ID)).toMatchObject({
      status: 'ACTIVE',
      sourceKeys: [registration.sourceKey],
    });
    expect(await repository.findSourceKeyOwners([ANOTHER_SOURCE_KEY])).toEqual(
      [],
    );
  });
});
