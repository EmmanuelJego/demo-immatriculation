import { ServiceUnavailableException } from '@nestjs/common';
import { Database } from '../database/database.module.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports the service as unavailable when the database cannot be reached', async () => {
    const unreachableDatabase = {
      execute: () => Promise.reject(new Error('connection refused')),
    } as unknown as Database;
    const controller = new HealthController(unreachableDatabase);

    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
