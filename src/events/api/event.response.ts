import { ApiProperty } from '@nestjs/swagger';
import type { Page } from '../../common/pagination/page.js';
import { PaginationResponse } from '../../common/pagination/pagination.response.js';
import {
  EVENT_TYPES,
  type EventLogEntry,
  type EventType,
  type JsonObject,
} from '../domain/event.js';

export class EventResponse {
  @ApiProperty({
    description: 'Global, strictly increasing position in the event log',
    example: 1,
  })
  readonly sequence: number;

  @ApiProperty({ enum: EVENT_TYPES, example: 'ProjectRegistered' })
  readonly type: EventType;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T17:00:00.000Z' })
  readonly occurredAt: string;

  @ApiProperty({ type: [String], example: ['PRJ-7KQ2-M9XD'] })
  readonly projectIds: readonly string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Details of the action, specific to each event type',
  })
  readonly payload: JsonObject;
}

export class EventPageResponse {
  @ApiProperty({ type: [EventResponse] })
  readonly data: readonly EventResponse[];

  @ApiProperty({ type: PaginationResponse })
  readonly pagination: PaginationResponse;
}

export function toEventPageResponse(
  page: Page<EventLogEntry>,
): EventPageResponse {
  return {
    data: page.items.map((entry) => ({
      ...entry,
      occurredAt: entry.occurredAt.toISOString(),
    })),
    pagination: {
      after: page.after,
      limit: page.limit,
      nextAfter: page.nextAfter,
    },
  };
}
