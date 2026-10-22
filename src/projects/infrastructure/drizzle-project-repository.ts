import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database.module.js';
import { projects, sourceKeys } from '../../database/schema.js';
import { violatedUniqueConstraint } from '../../database/unique-violation.js';
import type { ProjectId } from '../domain/project-id.js';
import type {
  NewProject,
  Project,
  SourceKey,
  SourceKeyOwnership,
} from '../domain/project.js';
import {
  DuplicateProjectId,
  DuplicateSourceKey,
  type ProjectRepository,
  type StoredSplit,
} from '../domain/project-repository.js';

const PROJECTS_PRIMARY_KEY = 'projects_pkey';
const SOURCE_KEYS_PRIMARY_KEY = 'source_keys_pkey';

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  findById(id: ProjectId): Promise<Project | null> {
    return this.findOne(eq(projects.id, id));
  }

  async findManyById(ids: readonly ProjectId[]): Promise<Project[]> {
    const loaded = await this.findAll(inArray(projects.id, [...ids]));
    return ids.flatMap(
      (id) => loaded.find((project) => project.id === id) ?? [],
    );
  }

  findSourceKeyOrigin(key: SourceKey): Promise<Project | null> {
    const origin = this.db
      .select({ id: sourceKeys.originProjectId })
      .from(sourceKeys)
      .where(isSourceKey(key));
    return this.findOne(inArray(projects.id, origin));
  }

  async findByIdForUpdate(id: ProjectId): Promise<Project | null> {
    const [project] = await this.findManyByIdForUpdate([id]);
    return project ?? null;
  }

  // The locks are taken on the project rows alone: PostgreSQL cannot lock the
  // nullable side of the outer join that loads their source keys.
  async findManyByIdForUpdate(ids: readonly ProjectId[]): Promise<Project[]> {
    const locked = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(inArray(projects.id, [...ids]))
      .orderBy(asc(projects.id))
      .for('update');
    if (locked.length === 0) {
      return [];
    }
    return this.findAll(
      inArray(
        projects.id,
        locked.map(({ id }) => id),
      ),
    );
  }

  async findSourceKeyOwner(key: SourceKey): Promise<ProjectId | null> {
    const [row] = await this.db
      .select({ projectId: sourceKeys.projectId })
      .from(sourceKeys)
      .where(isSourceKey(key));
    return row?.projectId ?? null;
  }

  async findSourceKeyOwners(
    keys: readonly SourceKey[],
  ): Promise<SourceKeyOwnership[]> {
    // Without a key, or() would drop the condition and select every key.
    if (keys.length === 0) {
      return [];
    }
    const rows = await this.db
      .select({
        system: sourceKeys.system,
        externalId: sourceKeys.externalId,
        projectId: sourceKeys.projectId,
      })
      .from(sourceKeys)
      .where(or(...keys.map(isSourceKey)));
    return rows.map(({ projectId, ...sourceKey }) => ({
      sourceKey,
      projectId,
    }));
  }

  async attachSourceKey(projectId: ProjectId, key: SourceKey): Promise<void> {
    try {
      await this.db
        .insert(sourceKeys)
        .values({ ...key, projectId, originProjectId: projectId });
    } catch (error) {
      throw toDuplicateError(error) ?? error;
    }
  }

  async mergeInto(
    survivorId: ProjectId,
    absorbedIds: readonly ProjectId[],
  ): Promise<Project> {
    const absorbed = [...absorbedIds];
    await this.db
      .update(sourceKeys)
      .set({ projectId: survivorId })
      .where(inArray(sourceKeys.projectId, absorbed));
    await this.db
      .update(projects)
      .set({ status: 'MERGED', mergedInto: survivorId })
      .where(inArray(projects.id, absorbed));
    const [survivor] = await this.findAll(eq(projects.id, survivorId));
    return survivor;
  }

  async split(
    sourceId: ProjectId,
    successors: readonly NewProject[],
  ): Promise<StoredSplit> {
    const ids = successors.map(({ id }) => id);
    const allocation = successors.flatMap(({ id, sourceKeys: keys }) =>
      keys.map((key) => ({ ...key, projectId: id })),
    );
    try {
      await this.db.insert(projects).values(successors.map(toProjectRow));
      const transferred = await this.transferSourceKeys(sourceId, allocation);
      await this.attachNewSourceKeys(
        allocation.filter(
          (key) => !transferred.some((other) => isSameKey(other, key)),
        ),
      );
    } catch (error) {
      throw toDuplicateError(error) ?? error;
    }
    await this.db
      .update(projects)
      .set({ status: 'SPLIT', splitInto: ids })
      .where(eq(projects.id, sourceId));
    const [source, ...stored] = await this.findManyById([sourceId, ...ids]);
    return { source, successors: stored };
  }

  // Moves each key the source owns to the successor it is allocated to, and
  // returns the keys moved.
  private async transferSourceKeys(
    sourceId: ProjectId,
    allocation: readonly AllocatedSourceKey[],
  ): Promise<SourceKey[]> {
    if (allocation.length === 0) {
      return [];
    }
    const rows = sql.join(
      allocation.map(
        ({ system, externalId, projectId }) =>
          sql`(${system}, ${externalId}, ${projectId})`,
      ),
      sql`, `,
    );
    const { rows: transferred } = await this.db.execute<{
      system: string;
      external_id: string;
    }>(sql`
      update ${sourceKeys}
      set project_id = allocation.project_id
      from (values ${rows}) as allocation (system, external_id, project_id)
      where ${sourceKeys.projectId} = ${sourceId}
        and ${sourceKeys.system} = allocation.system
        and ${sourceKeys.externalId} = allocation.external_id
      returning ${sourceKeys.system}, ${sourceKeys.externalId}
    `);
    return transferred.map(({ system, external_id }) => ({
      system,
      externalId: external_id,
    }));
  }

  // In a single statement and in key order: two commands inserting the same
  // keys then wait on them in the same order, and cannot deadlock.
  private async attachNewSourceKeys(
    keys: readonly AllocatedSourceKey[],
  ): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    await this.db
      .insert(sourceKeys)
      .values(
        [...keys]
          .sort(compareSourceKeys)
          .map((key) => ({ ...key, originProjectId: key.projectId })),
      );
  }

  private async findOne(condition: SQL): Promise<Project | null> {
    const [project] = await this.findAll(condition);
    return project ?? null;
  }

  // Loads the projects with their source keys in a single query.
  private async findAll(condition: SQL): Promise<Project[]> {
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
        asc(projects.id),
        asc(sourceKeys.attachedAt),
        asc(sourceKeys.system),
        asc(sourceKeys.externalId),
      );
    const byId = new Map<ProjectId, Project>();
    for (const { project, sourceKey } of rows) {
      const loaded = byId.get(project.id) ?? { ...project, sourceKeys: [] };
      byId.set(
        project.id,
        sourceKey
          ? { ...loaded, sourceKeys: [...loaded.sourceKeys, sourceKey] }
          : loaded,
      );
    }
    return [...byId.values()];
  }

  async insert(project: NewProject): Promise<Project> {
    try {
      const [{ createdAt }] = await this.db
        .insert(projects)
        .values(toProjectRow(project))
        .returning({ createdAt: projects.createdAt });
      await this.db.insert(sourceKeys).values(
        project.sourceKeys.map((key) => ({
          ...key,
          projectId: project.id,
          originProjectId: project.id,
        })),
      );
      return { ...project, createdAt };
    } catch (error) {
      throw toDuplicateError(error) ?? error;
    }
  }
}

type AllocatedSourceKey = SourceKey & { readonly projectId: ProjectId };

// The project columns alone. Drizzle takes mutable arrays, the domain hands
// out readonly ones.
function toProjectRow(project: NewProject): typeof projects.$inferInsert {
  const { id, label, ownerSiren, status, mergedInto, splitInto } = project;
  return {
    id,
    label,
    ownerSiren,
    status,
    mergedInto,
    splitInto: splitInto && [...splitInto],
  };
}

function isSameKey(key: SourceKey, other: SourceKey): boolean {
  return key.system === other.system && key.externalId === other.externalId;
}

function compareSourceKeys(key: SourceKey, other: SourceKey): number {
  return (
    compare(key.system, other.system) ||
    compare(key.externalId, other.externalId)
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
