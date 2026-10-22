import { ApiProperty, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  ValidateNested,
} from 'class-validator';
import type { NewSuccessor } from '../domain/project.js';
import {
  RegisterProjectRequest,
  SourceKeyRequest,
} from './register-project.request.js';

const MIN_SUCCESSORS = 2;
// Bound the work, and the keys locked, of a single command.
const MAX_SUCCESSORS = 20;
const MAX_SOURCE_KEYS = 100;

export class SuccessorRequest
  extends PickType(RegisterProjectRequest, ['label', 'ownerSiren'] as const)
  implements NewSuccessor
{
  @ApiProperty({
    type: [SourceKeyRequest],
    description:
      'Keys of the successor: its share of the keys of the source, and possibly new keys attached to no project',
    minItems: 1,
    maxItems: MAX_SOURCE_KEYS,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_SOURCE_KEYS)
  @ValidateNested({ each: true })
  @Type(() => SourceKeyRequest)
  readonly sourceKeys: SourceKeyRequest[];
}

export class SplitProjectRequest {
  @ApiProperty({
    type: [SuccessorRequest],
    description:
      'Projects to create; each key of the source goes to exactly one of them',
    minItems: MIN_SUCCESSORS,
    maxItems: MAX_SUCCESSORS,
  })
  @IsArray()
  @ArrayMinSize(MIN_SUCCESSORS)
  @ArrayMaxSize(MAX_SUCCESSORS)
  @ValidateNested({ each: true })
  @Type(() => SuccessorRequest)
  readonly successors: SuccessorRequest[];
}
