import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { NewEvent } from '../../src/events/domain/event.js';

export const EVENTS_PATH = '/v1/events';

export function anEvent(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    type: 'ProjectRegistered',
    projectIds: ['PRJ-7KQ2-M9XD'],
    payload: { label: 'Rénovation de l’école Jean Jaurès' },
    ...overrides,
  };
}

// The whole event log, as the API lists it on its first page.
export async function eventLog(app: INestApplication<App>): Promise<unknown[]> {
  const response = await request(app.getHttpServer()).get(EVENTS_PATH);
  return response.body.data;
}
