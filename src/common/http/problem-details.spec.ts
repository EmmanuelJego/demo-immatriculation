import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import {
  RequestValidationException,
  toProblemDetails,
  toValidationErrors,
} from './problem-details.js';

describe('toProblemDetails', () => {
  it('maps an HTTP exception to its status, standard title and message', () => {
    const message = 'Project PRJ-7KQ2-M9XD does not exist';

    const problem = toProblemDetails(new NotFoundException(message));

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: message,
    });
  });

  it('keeps the status of server-side HTTP exceptions', () => {
    const problem = toProblemDetails(
      new ServiceUnavailableException('Database unreachable'),
    );

    expect(problem.status).toBe(503);
    expect(problem.title).toBe('Service Unavailable');
  });

  it('lists the invalid fields of a request validation failure', () => {
    const fieldErrors = [
      { field: 'limit', messages: ['limit must not be greater than 200'] },
    ];

    const problem = toProblemDetails(
      new RequestValidationException(fieldErrors),
    );

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request is invalid',
      errors: fieldErrors,
    });
  });

  it('hides the internal message of an unexpected error behind a generic 500', () => {
    const problem = toProblemDetails(
      new Error('password authentication failed for user "immatriculation"'),
    );

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred',
    });
  });
});

describe('toValidationErrors', () => {
  it('flattens nested validation errors into dotted field paths', () => {
    const labelMessage = 'label should not be empty';
    const systemMessage = 'system must be a slug';

    const errors = toValidationErrors([
      validationError('label', { isNotEmpty: labelMessage }),
      validationError('sourceKey', undefined, [
        validationError('system', { matches: systemMessage }),
      ]),
    ]);

    expect(errors).toEqual([
      { field: 'label', messages: [labelMessage] },
      { field: 'sourceKey.system', messages: [systemMessage] },
    ]);
  });
});

function validationError(
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError {
  return Object.assign(new ValidationError(), {
    property,
    constraints,
    children,
  });
}
