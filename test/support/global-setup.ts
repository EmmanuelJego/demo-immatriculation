import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { testEnv } from './test-env.js';

export default async function migrateTestDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' });
  } finally {
    await pool.end();
  }
}
