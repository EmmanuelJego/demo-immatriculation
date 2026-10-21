import { Expose, plainToInstance, Type } from 'class-transformer';
import { IsInt, IsPositive, Matches, validateSync } from 'class-validator';

const DEFAULT_PORT = 3000;

export class Environment {
  @Expose()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a PostgreSQL connection URL',
  })
  readonly DATABASE_URL: string;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  readonly PORT: number = DEFAULT_PORT;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  const environment = plainToInstance(Environment, config, {
    excludeExtraneousValues: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(environment);
  if (errors.length > 0) {
    const details = errors
      .map(({ property, constraints }) =>
        [property, ...Object.values(constraints ?? {})].join(': '),
      )
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return environment;
}
