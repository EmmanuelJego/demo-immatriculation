import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Read from .env.test only, never from the shell, so integration tests
// cannot hit the development database by accident.
export const testEnv = parseEnv(readFileSync('.env.test', 'utf8')) as Record<
  string,
  string
>;
