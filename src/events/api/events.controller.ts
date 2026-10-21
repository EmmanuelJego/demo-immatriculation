import { Controller, Get, HttpStatus, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse } from '../../common/http/problem-details.response.js';
import { CursorPageQuery } from '../../common/pagination/cursor-page.query.js';
import {
  EVENT_LOG_READER,
  type EventLogReader,
} from '../application/event-log.js';
import { EventPageResponse, toEventPageResponse } from './event.response.js';

@ApiTags('events')
@Controller({ path: 'events', version: '1' })
export class EventsController {
  constructor(
    @Inject(EVENT_LOG_READER) private readonly eventLog: EventLogReader,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the event log in sequence order',
    description:
      'Every action on the registry, oldest first. Pass `pagination.nextAfter` as `after` to read the next page.',
  })
  @ApiOkResponse({ type: EventPageResponse })
  @ApiProblemResponse(HttpStatus.BAD_REQUEST, 'Invalid pagination parameters')
  async list(@Query() query: CursorPageQuery): Promise<EventPageResponse> {
    const page = await this.eventLog.list(query);
    return toEventPageResponse(page);
  }
}
