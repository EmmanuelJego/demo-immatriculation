import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Variables already set in the shell win, so `DATABASE_URL=… pnpm db:migrate`
// can target another database.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set (see .env.example)');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
