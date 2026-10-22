import type { NewEvent } from '../../events/domain/event.js';
import {
  ProjectNotActive,
  SourceKeyAlreadyRegistered,
  SourceKeyOwnedByAnotherProject,
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
  readonly sourceKeys: readonly SourceKey[];
  readonly createdAt: Date;
}

// A project before the registry has stored it and dated its creation.
export type NewProject = Omit<Project, 'createdAt'>;

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

// Merged and split projects are kept for the record, but are closed.
function assertActive(project: Project): void {
  if (project.status !== 'ACTIVE') {
    throw new ProjectNotActive(project.id, project.status);
  }
}
