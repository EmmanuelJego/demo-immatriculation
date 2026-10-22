import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { eq, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../src/database/database.module.js';
import { projects } from '../../src/database/schema.js';
import { DrizzleUnitOfWork } from '../../src/projects/infrastructure/drizzle-unit-of-work.js';
import { contendWith } from '../support/concurrency.js';
import {
  ANOTHER_SOURCE_KEY,
  aRegistration,
  PROJECTS_PATH,
  registerProject,
} from '../support/projects.js';
import { createTestApp, resetDatabase } from '../support/test-app.js';

const MERGED_INTO_VIOLATION = /projects_merged_into_check/;
const LOCK_NOT_AVAILABLE = '55P03';
const SPLIT_INTO_VIOLATION = /projects_split_into_check/;

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

  describe('findManyByIdForUpdate', () => {
    async function isLocked(id: string): Promise<boolean> {
      const attempt = db.transaction((tx) =>
        tx.execute(
          sql`select id from projects where id = ${id} for update nowait`,
        ),
      );
      return attempt.then(
        () => false,
        (error: unknown) =>
          (error as { cause?: { code?: string } }).cause?.code ===
          LOCK_NOT_AVAILABLE,
      );
    }

    it('locks the projects in ascending id order, whatever the order asked', async () => {
      const ids = [
        (await registerProject(app)).id,
        (
          await registerProject(
            app,
            aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
          )
        ).id,
      ];
      const [lower, higher] = ids.sort();
      let lowerLockedWhileWaiting = false;

      const locked = await contendWith(
        db,
        async ({ projects }) => {
          await projects.findByIdForUpdate(higher);
        },
        () =>
          new DrizzleUnitOfWork(db).run(({ projects }) =>
            projects.findManyByIdForUpdate([higher, lower]),
          ),
        async () => {
          lowerLockedWhileWaiting = await isLocked(lower);
        },
      );

      expect(lowerLockedWhileWaiting).toBe(true);
      expect(locked.map(({ id }) => id).sort()).toEqual([lower, higher]);
    });
  });

  describe('findSourceKeyOwners', () => {
    it('finds no owner for no key, even when keys are attached', async () => {
      await registerProject(app);

      const owners = await new DrizzleUnitOfWork(db).run(({ projects }) =>
        projects.findSourceKeyOwners([]),
      );

      expect(owners).toEqual([]);
    });
  });

  describe('projects table', () => {
    it('refuses a merged project that points to no survivor', async () => {
      const project = await registerProject(app);

      const update = db
        .update(projects)
        .set({ status: 'MERGED' })
        .where(eq(projects.id, project.id));

      await expect(update).rejects.toHaveProperty(
        'cause.message',
        expect.stringMatching(MERGED_INTO_VIOLATION),
      );
    });

    const SPLIT_INCONSISTENCIES: {
      case: string;
      set: { status?: 'SPLIT'; splitInto?: string[] };
    }[] = [
      { case: 'a split project without successors', set: { status: 'SPLIT' } },
      {
        case: 'a split project with a single successor',
        set: { status: 'SPLIT', splitInto: ['PRJ-0000-0001'] },
      },
      {
        case: 'an active project with successors',
        set: { splitInto: ['PRJ-0000-0001', 'PRJ-0000-0002'] },
      },
    ];

    it.each(SPLIT_INCONSISTENCIES)('refuses $case', async ({ set }) => {
      const project = await registerProject(app);

      const update = db
        .update(projects)
        .set(set)
        .where(eq(projects.id, project.id));

      await expect(update).rejects.toHaveProperty(
        'cause.message',
        expect.stringMatching(SPLIT_INTO_VIOLATION),
      );
    });

    it('refuses a project merged into itself', async () => {
      const project = await registerProject(app);

      const update = db
        .update(projects)
        .set({ status: 'MERGED', mergedInto: project.id })
        .where(eq(projects.id, project.id));

      await expect(update).rejects.toHaveProperty(
        'cause.message',
        expect.stringMatching(MERGED_INTO_VIOLATION),
      );
    });

    it('refuses an active project that points to a survivor', async () => {
      const project = await registerProject(app);
      const other = await registerProject(
        app,
        aRegistration({ sourceKey: ANOTHER_SOURCE_KEY }),
      );

      const update = db
        .update(projects)
        .set({ mergedInto: other.id })
        .where(eq(projects.id, project.id));

      await expect(update).rejects.toHaveProperty(
        'cause.message',
        expect.stringMatching(MERGED_INTO_VIOLATION),
      );
    });
  });
});
