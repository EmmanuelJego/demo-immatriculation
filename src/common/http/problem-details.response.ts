import { applyDecorators, HttpStatus } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { FieldError, ProblemDetails } from './problem-details.js';

class FieldErrorResponse implements FieldError {
  @ApiProperty({ example: 'limit' })
  readonly field: string;

  @ApiProperty({
    type: [String],
    example: ['limit must not be greater than 200'],
  })
  readonly messages: readonly string[];
}

export class ProblemDetailsResponse implements ProblemDetails {
  @ApiProperty({ example: 'about:blank' })
  readonly type: string;

  @ApiProperty({ example: 'Bad Request' })
  readonly title: string;

  @ApiProperty({ example: 400 })
  readonly status: number;

  @ApiProperty({ example: 'The request is invalid' })
  readonly detail: string;

  @ApiPropertyOptional({
    type: [FieldErrorResponse],
    description: 'Invalid fields, on validation problems only',
  })
  readonly errors?: readonly FieldErrorResponse[];
}

export function ApiProblemResponse(
  status: HttpStatus,
  description: string,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ProblemDetailsResponse),
    ApiResponse({
      status,
      description,
      content: {
        'application/problem+json': {
          schema: { $ref: getSchemaPath(ProblemDetailsResponse) },
        },
      },
    }),
  );
}
