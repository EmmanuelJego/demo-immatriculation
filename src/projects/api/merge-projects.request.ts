import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';
import { PROJECT_ID_PATTERN } from '../domain/project-id.js';

// Bounds the number of projects a single command locks.
const MAX_ABSORBED = 100;

export class MergeProjectsRequest {
  @ApiProperty({
    description:
      'Registration ids of the projects the survivor absorbs; those already merged into it are ignored',
    example: ['PRJ-AB12-CD34'],
    type: 'string',
    isArray: true,
    pattern: PROJECT_ID_PATTERN,
    minItems: 1,
    maxItems: MAX_ABSORBED,
    uniqueItems: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_ABSORBED)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(new RegExp(PROJECT_ID_PATTERN), {
    each: true,
    message: 'each value in absorbed must be a registration id',
  })
  readonly absorbed: string[];
}
