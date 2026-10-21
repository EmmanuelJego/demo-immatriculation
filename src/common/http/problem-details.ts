import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { STATUS_CODES } from 'node:http';
import { DomainError, type DomainErrorKind } from '../errors/domain-error.js';

const STATUS_BY_DOMAIN_ERROR_KIND: Record<DomainErrorKind, HttpStatus> = {
  'not-found': HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  invalid: HttpStatus.UNPROCESSABLE_ENTITY,
};

export interface FieldError {
  readonly field: string;
  readonly messages: readonly string[];
}

// RFC 9457 Problem Details.
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly errors?: readonly FieldError[];
}

export class RequestValidationException extends BadRequestException {
  constructor(readonly errors: readonly FieldError[]) {
    super('The request is invalid');
  }
}

export function toProblemDetails(exception: unknown): ProblemDetails {
  if (exception instanceof DomainError) {
    return {
      ...problem(
        new HttpException(
          exception.message,
          STATUS_BY_DOMAIN_ERROR_KIND[exception.kind],
        ),
      ),
      type: `urn:immatriculation:problem:${exception.code}`,
    };
  }
  if (exception instanceof RequestValidationException) {
    return { ...problem(exception), errors: exception.errors };
  }
  if (exception instanceof HttpException) {
    return problem(exception);
  }
  return problem(
    new HttpException(
      'An unexpected error occurred',
      HttpStatus.INTERNAL_SERVER_ERROR,
    ),
  );
}

export function toValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const messages = Object.values(error.constraints ?? {});
    const own = messages.length > 0 ? [{ field, messages }] : [];
    return [...own, ...toValidationErrors(error.children ?? [], field)];
  });
}

function problem(exception: HttpException): ProblemDetails {
  const status = exception.getStatus();
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    detail: exception.message,
  };
}
