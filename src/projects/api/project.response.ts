import { ApiProperty } from '@nestjs/swagger';
import {
  PROJECT_STATUSES,
  type Project,
  type ProjectStatus,
} from '../domain/project.js';

export class SourceKeyResponse {
  @ApiProperty({ example: 'dotations' })
  readonly system: string;

  @ApiProperty({ example: 'DOS-2026-0001' })
  readonly externalId: string;
}

export class ProjectResponse {
  @ApiProperty({
    description: 'Registration id: unique, opaque and permanent',
    example: 'PRJ-7KQ2-M9XD',
  })
  readonly id: string;

  @ApiProperty({ example: 'Rénovation de l’école Jean Jaurès' })
  readonly label: string;

  @ApiProperty({ example: '213105554' })
  readonly ownerSiren: string;

  @ApiProperty({ enum: PROJECT_STATUSES, example: 'ACTIVE' })
  readonly status: ProjectStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Survivor that absorbed the project, when it is MERGED: clients follow this link',
    example: null,
  })
  readonly mergedInto: string | null;

  @ApiProperty({
    type: [String],
    nullable: true,
    description:
      'Successors created from the project, when it is SPLIT: clients follow these links',
    example: null,
  })
  readonly splitInto: readonly string[] | null;

  @ApiProperty({ type: [SourceKeyResponse] })
  readonly sourceKeys: readonly SourceKeyResponse[];

  @ApiProperty({ format: 'date-time', example: '2026-10-21T17:00:00.000Z' })
  readonly createdAt: string;
}

export function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    label: project.label,
    ownerSiren: project.ownerSiren,
    status: project.status,
    mergedInto: project.mergedInto,
    splitInto: project.splitInto && [...project.splitInto],
    sourceKeys: project.sourceKeys.map(({ system, externalId }) => ({
      system,
      externalId,
    })),
    createdAt: project.createdAt.toISOString(),
  };
}

export class SplitResponse {
  @ApiProperty({ type: ProjectResponse, description: 'The source, now SPLIT' })
  readonly source: ProjectResponse;

  @ApiProperty({ type: [ProjectResponse] })
  readonly successors: readonly ProjectResponse[];
}

export class ProjectListResponse {
  @ApiProperty({ type: [ProjectResponse] })
  readonly data: readonly ProjectResponse[];
}
