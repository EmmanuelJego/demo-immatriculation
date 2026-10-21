import { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { DATABASE, type Database } from '../../src/database/database.module.js';

// `customize` can override providers, e.g. to make a generator deterministic.
export async function createTestApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
    builder,
  ) => builder,
): Promise<INestApplication<App>> {
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  const db = app.get<Database>(DATABASE);
  const { rows } = await db.execute<{ name: string }>(
    sql`select current_database() as name`,
  );
  if (!rows[0].name.endsWith('_test')) {
    throw new Error(`Refusing to wipe non-test database "${rows[0].name}"`);
  }

  const { rows: tables } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (tables.length === 0) {
    return;
  }

  const tableList = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
  await db.execute(
    sql.raw(`truncate table ${tableList} restart identity cascade`),
  );
}
