import {
  buildMessage,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';
import { isValidSiren } from '../domain/siren.js';

export function IsSiren(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSiren',
      validator: {
        validate: (value) => typeof value === 'string' && isValidSiren(value),
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be a SIREN: 9 digits ending with a valid Luhn check digit`,
          options,
        ),
      },
    },
    options,
  );
}
