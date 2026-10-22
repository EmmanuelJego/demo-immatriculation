import {
  ProjectNotActive,
  SourceKeyAlreadyRegistered,
  SourceKeyOwnedByAnotherProject,
} from './errors.js';
import {
  attachSourceKey,
  registerProject,
  resolveRegistration,
  type Project,
  type Registration,
} from './project.js';

const PROJECT_ID = 'PRJ-7KQ2-M9XD';
const REGISTRATION: Registration = {
  label: 'Rénovation de l’école Jean Jaurès',
  ownerSiren: '213105554',
  sourceKey: { system: 'dotations', externalId: 'DOS-2026-0001' },
};

const REGISTERED_PROJECT: Project = {
  ...registerProject(REGISTRATION, PROJECT_ID).project,
  createdAt: new Date('2026-10-21T17:00:00.000Z'),
};
const NEW_SOURCE_KEY = { system: 'guichet-unique', externalId: 'GU-42' };
const OTHER_PROJECT_ID = 'PRJ-AB12-CD34';

describe('registerProject', () => {
  it('creates an active project that carries its initial source key', () => {
    const { project } = registerProject(REGISTRATION, PROJECT_ID);

    expect(project).toEqual({
      id: PROJECT_ID,
      label: REGISTRATION.label,
      ownerSiren: REGISTRATION.ownerSiren,
      status: 'ACTIVE',
      sourceKeys: [REGISTRATION.sourceKey],
    });
  });

  it('describes the registration in a ProjectRegistered event', () => {
    const { event } = registerProject(REGISTRATION, PROJECT_ID);

    expect(event).toEqual({
      type: 'ProjectRegistered',
      projectIds: [PROJECT_ID],
      payload: REGISTRATION,
    });
  });
});

describe('resolveRegistration', () => {
  const existing = REGISTERED_PROJECT;

  it('treats a registration with the same attributes as a replay of the existing project', () => {
    expect(resolveRegistration(existing, { ...REGISTRATION })).toBe(existing);
  });

  it.each([
    { attribute: 'label', change: { label: 'Construction d’un gymnase' } },
    { attribute: 'ownerSiren', change: { ownerSiren: '217500016' } },
  ])(
    'rejects a registration whose $attribute differs from the existing project',
    ({ change }) => {
      expect(() =>
        resolveRegistration(existing, { ...REGISTRATION, ...change }),
      ).toThrow(SourceKeyAlreadyRegistered);
    },
  );
});

describe('attachSourceKey', () => {
  it('adds the key to an active project and describes it in a SourceKeyAttached event', () => {
    const attachment = attachSourceKey(
      REGISTERED_PROJECT,
      NEW_SOURCE_KEY,
      null,
    );

    expect(attachment).toEqual({
      project: {
        ...REGISTERED_PROJECT,
        sourceKeys: [...REGISTERED_PROJECT.sourceKeys, NEW_SOURCE_KEY],
      },
      event: {
        type: 'SourceKeyAttached',
        projectIds: [PROJECT_ID],
        payload: { sourceKey: NEW_SOURCE_KEY },
      },
    });
  });

  it('changes nothing when the key is already attached to the project', () => {
    const attachment = attachSourceKey(
      REGISTERED_PROJECT,
      REGISTRATION.sourceKey,
      PROJECT_ID,
    );

    expect(attachment).toEqual({ project: REGISTERED_PROJECT, event: null });
  });

  it('rejects a key that belongs to another project', () => {
    expect(() =>
      attachSourceKey(REGISTERED_PROJECT, NEW_SOURCE_KEY, OTHER_PROJECT_ID),
    ).toThrow(SourceKeyOwnedByAnotherProject);
  });

  it.each(['MERGED', 'SPLIT'] as const)(
    'rejects any attachment to a %s project',
    (status) => {
      expect(() =>
        attachSourceKey(
          { ...REGISTERED_PROJECT, status },
          NEW_SOURCE_KEY,
          null,
        ),
      ).toThrow(ProjectNotActive);
    },
  );

  it('reports a closed project before a key owned elsewhere', () => {
    expect(() =>
      attachSourceKey(
        { ...REGISTERED_PROJECT, status: 'MERGED' },
        NEW_SOURCE_KEY,
        OTHER_PROJECT_ID,
      ),
    ).toThrow(ProjectNotActive);
  });
});
