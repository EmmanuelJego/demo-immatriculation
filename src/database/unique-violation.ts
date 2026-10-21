const UNIQUE_VIOLATION = '23505';

// Name of the unique constraint the error violates, if it is one. Drizzle
// wraps driver errors, so PostgreSQL's details are on `cause`.
export function violatedUniqueConstraint(error: unknown): string | null {
  const cause = error instanceof Error ? error.cause : undefined;
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === UNIQUE_VIOLATION &&
    'constraint' in cause &&
    typeof cause.constraint === 'string'
  ) {
    return cause.constraint;
  }
  return null;
}
