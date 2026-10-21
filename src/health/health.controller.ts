import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { ApiProblemResponse } from '../common/http/problem-details.response.js';
import { DATABASE, type Database } from '../database/database.module.js';

export class HealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  readonly status: 'ok';
}

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @ApiOkResponse({ type: HealthResponse })
  @ApiProblemResponse(HttpStatus.SERVICE_UNAVAILABLE, 'Database unreachable')
  async check(): Promise<HealthResponse> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ok' };
  }
}
