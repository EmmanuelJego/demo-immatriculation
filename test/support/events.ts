import type { NewEvent } from '../../src/events/domain/event.js';

export function anEvent(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    type: 'ProjectRegistered',
    projectIds: ['PRJ-7KQ2-M9XD'],
    payload: { label: 'Rénovation de l’école Jean Jaurès' },
    ...overrides,
  };
}
