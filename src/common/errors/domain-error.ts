// What went wrong, in business terms. The HTTP layer derives a status from it,
// so the domain never depends on HTTP.
export type DomainErrorKind = 'not-found' | 'conflict' | 'invalid';

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly kind: DomainErrorKind;
}
