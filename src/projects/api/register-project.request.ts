import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { Registration, SourceKey } from '../domain/project.js';
import { IsSiren } from './is-siren.validator.js';

const MAX_LABEL_LENGTH = 200;
const MAX_SYSTEM_LENGTH = 50;
const MAX_EXTERNAL_ID_LENGTH = 100;
const SYSTEM_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NOT_BLANK = /\S/;
// PostgreSQL text columns cannot store U+0000, so that control character is
// exactly what this pattern must match.
// oxlint-disable-next-line no-control-regex
const WITHOUT_NUL = /^[^\u0000]*$/;
const WITHOUT_NUL_MESSAGE = '$property must not contain a NUL character';

export class SourceKeyRequest implements SourceKey {
  @ApiProperty({
    description: 'System the project comes from, as a lowercase slug',
    example: 'dotations',
    pattern: SYSTEM_SLUG.source,
    maxLength: MAX_SYSTEM_LENGTH,
  })
  @IsString()
  @Matches(SYSTEM_SLUG, {
    message: 'system must be a lowercase slug, such as "guichet-unique"',
  })
  @MaxLength(MAX_SYSTEM_LENGTH)
  readonly system: string;

  @ApiProperty({
    description: 'Identifier of the project in that system',
    example: 'DOS-2026-0001',
    minLength: 1,
    maxLength: MAX_EXTERNAL_ID_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(WITHOUT_NUL, { message: WITHOUT_NUL_MESSAGE })
  @MaxLength(MAX_EXTERNAL_ID_LENGTH)
  readonly externalId: string;
}

export class RegisterProjectRequest implements Registration {
  @ApiProperty({
    example: 'Rénovation de l’école Jean Jaurès',
    maxLength: MAX_LABEL_LENGTH,
  })
  @IsString()
  @Matches(NOT_BLANK, { message: 'label must not be blank' })
  @Matches(WITHOUT_NUL, { message: WITHOUT_NUL_MESSAGE })
  @MaxLength(MAX_LABEL_LENGTH)
  readonly label: string;

  @ApiProperty({
    description:
      'SIREN of the local authority carrying the project: 9 digits ending with a Luhn check digit',
    example: '213105554',
    pattern: '^\\d{9}$',
  })
  @IsSiren()
  readonly ownerSiren: string;

  @ApiProperty({
    type: SourceKeyRequest,
    description:
      'Key of the project in its source system, which makes the registration idempotent',
  })
  @IsObject()
  @ValidateNested()
  @Type(() => SourceKeyRequest)
  readonly sourceKey: SourceKeyRequest;
}
