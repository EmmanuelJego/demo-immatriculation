import { Module } from '@nestjs/common';
import { DATABASE, type Database } from '../database/database.module.js';
import { EventsController } from './api/events.controller.js';
import { EVENT_LOG_READER } from './application/event-log.js';
import { DrizzleEventLog } from './infrastructure/drizzle-event-log.js';

@Module({
  controllers: [EventsController],
  providers: [
    {
      provide: EVENT_LOG_READER,
      inject: [DATABASE],
      useFactory: (db: Database) => new DrizzleEventLog(db),
    },
  ],
  exports: [EVENT_LOG_READER],
})
export class EventsModule {}
