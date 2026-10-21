import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database.module.js';
import { projects, sourceKeys } from '../../database/schema.js';
import { violatedUniqueConstraint } from '../../database/unique-violation.js';
import type { ProjectId } from '../domain/project-id.js';
import type { NewProject, Project, SourceKey } from '../domain/project.js';
import {
  DuplicateProjectId,
  DuplicateSourceKey,
  type ProjectRepository,
} from '../domain/project-repository.js';

const PROJECTS_PRIMARY_KEY = 'projects_pkey';
const SOURCE_KEYS_PRIMARY_KEY = 'source_keys_pkey';

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  findById(id: ProjectId): Promise<Project | null> {
    return this.findOne(eq(projects.id, id));
  }

  findBySourceKey(key: SourceKey): Promise<Project | null> {
    const owner = this.db
      .select({ id: sourceKeys.projectId })
      .from(sourceKeys)
      .where(
        and(
          eq(sourceKeys.system, key.system),
          eq(sourceKeys.externalId, key.externalId),
        ),
      );
    return this.findOne(inArray(projects.id, owner));
  }

  private async findOne(condition: SQL): Promise<Project | null> {
    const rows = await this.db
      .select({
        project: projects,
        sourceKey: {
          system: sourceKeys.system,
          externalId: sourceKeys.externalId,
        },
      })
      .from(projects)
      .leftJoin(sourceKeys, eq(sourceKeys.projectId, projects.id))
      .where(condition)
      .orderBy(
        asc(sourceKeys.attachedAt),
        asc(sourceKeys.system),
        asc(sourceKeys.externalId),
      );
    if (rows.length === 0) {
      return null;
    }
    return {
      ...rows[0].project,
      sourceKeys: rows.flatMap(({ sourceKey }) =>
        sourceKey ? [sourceKey] : [],
      ),
    };
  }

  async insert(project: NewProject): Promise<Project> {
    const { sourceKeys: keys, ...attributes } = project;
    try {
      const [{ createdAt }] = await this.db
        .insert(projects)
        .values(attributes)
        .returning({ createdAt: projects.createdAt });
      await this.db
        .insert(sourceKeys)
        .values(keys.map((key) => ({ ...key, projectId: project.id })));
      return { ...project, createdAt };
    } catch (error) {
      throw toDuplicateError(error) ?? error;
    }
  }
}

function toDuplicateError(error: unknown): Error | null {
  switch (violatedUniqueConstraint(error)) {
    case PROJECTS_PRIMARY_KEY:
      return new DuplicateProjectId({ cause: error });
    case SOURCE_KEYS_PRIMARY_KEY:
      return new DuplicateSourceKey({ cause: error });
    default:
      return null;
  }
}
