import type { NewEvent } from '../../events/domain/event.js';
import {
  ProjectAlreadySplit,
  ProjectNotActive,
  SourceKeyAllocatedTwice,
  SourceKeyAlreadyRegistered,
  SourceKeyNotAllocated,
  SourceKeyOwnedByAnotherProject,
  SurvivorAmongAbsorbed,
} from './errors.js';
import type { ProjectId } from './project-id.js';

export const PROJECT_STATUSES = ['ACTIVE', 'MERGED', 'SPLIT'] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Type aliases rather than interfaces: they must fit in a JSON event payload.
export type SourceKey = {
  readonly system: string;
  readonly externalId: string;
};

export type Registration = {
  readonly label: string;
  readonly ownerSiren: string;
  readonly sourceKey: SourceKey;
};

export interface Project {
  readonly id: ProjectId;
  readonly label: string;
  readonly ownerSiren: string;
  readonly status: ProjectStatus;
  // The survivor that absorbed the project, once it is MERGED.
  readonly mergedInto: ProjectId | null;
  // The successors created from the project, once it is SPLIT.
  readonly splitInto: readonly ProjectId[] | null;
  readonly sourceKeys: readonly SourceKey[];
  readonly createdAt: Date;
}

// A project before the registry has stored it and dated its creation.
export type NewProject = Omit<Project, 'createdAt'>;

// The project a source key is attached to.
export interface SourceKeyOwnership {
  readonly sourceKey: SourceKey;
  readonly projectId: ProjectId;
}

export interface ProjectRegistered extends NewEvent {
  readonly type: 'ProjectRegistered';
  readonly projectIds: readonly [ProjectId];
  readonly payload: Registration;
}

export function registerProject(
  registration: Registration,
  id: ProjectId,
): { project: NewProject; event: ProjectRegistered } {
  const { label, ownerSiren } = registration;
  const sourceKey = {
    system: registration.sourceKey.system,
    externalId: registration.sourceKey.externalId,
  };
  return {
    project: {
      id,
      label,
      ownerSiren,
      status: 'ACTIVE',
      mergedInto: null,
      splitInto: null,
      sourceKeys: [sourceKey],
    },
    event: {
      type: 'ProjectRegistered',
      projectIds: [id],
      payload: { label, ownerSiren, sourceKey },
    },
  };
}

// A registration whose source key is already registered is a replay of the
// project that owns it, provided it carries the same attributes.
export function resolveRegistration(
  existing: Project,
  registration: Registration,
): Project {
  const isReplay =
    existing.label === registration.label &&
    existing.ownerSiren === registration.ownerSiren;
  if (!isReplay) {
    throw new SourceKeyAlreadyRegistered(registration.sourceKey, existing.id);
  }
  return existing;
}

export interface SourceKeyAttached extends NewEvent {
  readonly type: 'SourceKeyAttached';
  readonly projectIds: readonly [ProjectId];
  readonly payload: { readonly sourceKey: SourceKey };
}

// `event` is null when nothing changed: the key was already attached.
export interface Attachment {
  readonly project: Project;
  readonly event: SourceKeyAttached | null;
}

export function attachSourceKey(
  project: Project,
  key: SourceKey,
  currentOwner: ProjectId | null,
): Attachment {
  assertActive(project);
  if (currentOwner === project.id) {
    return { project, event: null };
  }
  if (currentOwner !== null) {
    throw new SourceKeyOwnedByAnotherProject(key, currentOwner);
  }
  const sourceKey = { system: key.system, externalId: key.externalId };
  return {
    project: { ...project, sourceKeys: [...project.sourceKeys, sourceKey] },
    event: {
      type: 'SourceKeyAttached',
      projectIds: [project.id],
      payload: { sourceKey },
    },
  };
}

export interface ProjectsMerged extends NewEvent {
  readonly type: 'ProjectsMerged';
  readonly payload: {
    readonly survivor: ProjectId;
    readonly absorbed: readonly ProjectId[];
    readonly transferredSourceKeys: readonly SourceKey[];
  };
}

// `event` is null when nothing changed: every project was already absorbed.
export interface Merger {
  readonly absorbed: readonly Project[];
  readonly event: ProjectsMerged | null;
}

export function mergeProjects(
  survivor: Project,
  candidates: readonly Project[],
): Merger {
  if (candidates.some(({ id }) => id === survivor.id)) {
    throw new SurvivorAmongAbsorbed(survivor.id);
  }
  assertActive(survivor);
  const absorbed = candidates.filter(
    (project) => project.mergedInto !== survivor.id,
  );
  absorbed.forEach(assertActive);
  if (absorbed.length === 0) {
    return { absorbed: [], event: null };
  }
  const ids = absorbed.map(({ id }) => id);
  return {
    absorbed: absorbed.map((project) => ({
      ...project,
      status: 'MERGED',
      mergedInto: survivor.id,
      sourceKeys: [],
    })),
    event: {
      type: 'ProjectsMerged',
      projectIds: [survivor.id, ...ids],
      payload: {
        survivor: survivor.id,
        absorbed: ids,
        transferredSourceKeys: absorbed.flatMap(({ sourceKeys }) => sourceKeys),
      },
    },
  };
}

// A project to create by a split, with its share of the source keys.
export type NewSuccessor = {
  readonly label: string;
  readonly ownerSiren: string;
  readonly sourceKeys: readonly SourceKey[];
};

export interface ProjectSplit extends NewEvent {
  readonly type: 'ProjectSplit';
  readonly payload: {
    readonly source: ProjectId;
    readonly successors: readonly (NewSuccessor & { readonly id: ProjectId })[];
  };
}

export interface Split {
  readonly successors: readonly NewProject[];
  readonly event: ProjectSplit;
}

// `owners` are the current owners of the keys allocated to the successors.
export function splitProject(
  source: Project,
  successors: readonly NewSuccessor[],
  ids: readonly ProjectId[],
  owners: readonly SourceKeyOwnership[],
): Split {
  const allocated = successors.flatMap(({ sourceKeys }) => sourceKeys);
  assertAllocatedOnce(allocated);
  assertActive(source);
  const unallocated = source.sourceKeys.find(
    (key) => !allocated.some((other) => isSameKey(other, key)),
  );
  if (unallocated) {
    throw new SourceKeyNotAllocated(unallocated, source.id);
  }
  const ownedElsewhere = owners.find(
    ({ projectId }) => projectId !== source.id,
  );
  if (ownedElsewhere) {
    throw new SourceKeyOwnedByAnotherProject(
      ownedElsewhere.sourceKey,
      ownedElsewhere.projectId,
    );
  }
  const described = successors.map(
    ({ label, ownerSiren, sourceKeys }, index) => ({
      id: ids[index],
      label,
      ownerSiren,
      sourceKeys: sourceKeys.map(({ system, externalId }) => ({
        system,
        externalId,
      })),
    }),
  );
  return {
    successors: described.map((successor) => ({
      ...successor,
      status: 'ACTIVE',
      mergedInto: null,
      splitInto: null,
    })),
    event: {
      type: 'ProjectSplit',
      projectIds: [source.id, ...ids],
      payload: { source: source.id, successors: described },
    },
  };
}

// A split request on a project already split is a replay when it describes
// its successors exactly, in any order.
export function resolveSplit(
  source: Project,
  existing: readonly Project[],
  successors: readonly NewSuccessor[],
): readonly Project[] {
  assertAllocatedOnce(successors.flatMap(({ sourceKeys }) => sourceKeys));
  const isReplay =
    successors.length === existing.length &&
    successors.every((successor) =>
      existing.some((project) => describesProject(successor, project)),
    );
  if (!isReplay) {
    throw new ProjectAlreadySplit(source.id);
  }
  return existing;
}

function describesProject(successor: NewSuccessor, project: Project): boolean {
  return (
    successor.label === project.label &&
    successor.ownerSiren === project.ownerSiren &&
    successor.sourceKeys.length === project.sourceKeys.length &&
    successor.sourceKeys.every((key) =>
      project.sourceKeys.some((other) => isSameKey(other, key)),
    )
  );
}

function assertAllocatedOnce(keys: readonly SourceKey[]): void {
  const duplicate = keys.find(
    (key, index) => keys.findIndex((other) => isSameKey(other, key)) !== index,
  );
  if (duplicate) {
    throw new SourceKeyAllocatedTwice(duplicate);
  }
}

function isSameKey(key: SourceKey, other: SourceKey): boolean {
  return key.system === other.system && key.externalId === other.externalId;
}

// Merged and split projects are kept for the record, but are closed.
function assertActive(project: Project): void {
  if (project.status !== 'ACTIVE') {
    throw new ProjectNotActive(project.id, project.status);
  }
}
