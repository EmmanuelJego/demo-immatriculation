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
      .where(isSourceKey(key));
    return this.findOne(inArray(projects.id, owner));
  }

  // The lock is taken on the project row alone: PostgreSQL cannot lock the
  // nullable side of the outer join that loads its source keys.
  async findByIdForUpdate(id: ProjectId): Promise<Project | null> {
    const [locked] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, id))
      .for('update');
    return locked ? this.findById(id) : null;
  }

  async findSourceKeyOwner(key: SourceKey): Promise<ProjectId | null> {
    const [row] = await this.db
      .select({ projectId: sourceKeys.projectId })
      .from(sourceKeys)
      .where(isSourceKey(key));
    return row?.projectId ?? null;
  }

  async attachSourceKey(projectId: ProjectId, key: SourceKey): Promise<void> {
    try {
      await this.db.insert(sourceKeys).values({ ...key, projectId });
    } catch (error) {
      throw toDuplicateError(error) ?? error;
    }
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

function isSourceKey(key: SourceKey): SQL | undefined {
  return and(
    eq(sourceKeys.system, key.system),
    eq(sourceKeys.externalId, key.externalId),
  );
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
