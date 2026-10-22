import {
  DuplicateProjectId,
  DuplicateSourceKey,
} from '../domain/project-repository.js';

const MAX_ATTEMPTS = 3;

// Runs `attempt` again while it fails on a unique constraint: a concurrent
// transaction committed a conflicting write first, or a drawn id was taken.
// Each attempt must be a whole unit of work, rolled back on failure, so that
// the next one starts from the state that concurrent transaction left.
export async function retryOnDuplicate<T>(
  attempt: () => Promise<T>,
): Promise<T> {
  for (let attemptNumber = 1; ; attemptNumber++) {
    try {
      return await attempt();
    } catch (error) {
      if (!isDuplicate(error) || attemptNumber === MAX_ATTEMPTS) {
        throw error;
      }
    }
  }
}

function isDuplicate(error: unknown): boolean {
  return (
    error instanceof DuplicateProjectId || error instanceof DuplicateSourceKey
  );
}
