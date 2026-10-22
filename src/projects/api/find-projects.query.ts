import { PickType } from '@nestjs/swagger';
import { SourceKeyRequest } from './register-project.request.js';

// Both parameters are required: projects are only searched by source key.
export class FindProjectsQuery extends PickType(SourceKeyRequest, [
  'system',
  'externalId',
] as const) {}
