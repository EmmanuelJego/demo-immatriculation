import { validateEnvironment } from './environment.js';

const DATABASE_URL = 'postgres://user:password@localhost:5432/registry';

describe('validateEnvironment', () => {
  it('returns the typed configuration when the environment is valid', () => {
    const environment = validateEnvironment({ DATABASE_URL, PORT: '4000' });

    expect(environment).toEqual({ DATABASE_URL, PORT: 4000 });
  });

  it('defaults the port to 3000', () => {
    const environment = validateEnvironment({ DATABASE_URL });

    expect(environment.PORT).toBe(3000);
  });

  it('rejects a missing database URL', () => {
    expect(() => validateEnvironment({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL that is not a PostgreSQL URL', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'mysql://localhost/registry' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects a port that is not a positive integer', () => {
    expect(() => validateEnvironment({ DATABASE_URL, PORT: 'abc' })).toThrow(
      /PORT/,
    );
  });
});
