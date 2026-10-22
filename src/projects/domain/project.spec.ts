import {
  ProjectNotActive,
  SourceKeyAlreadyRegistered,
  SurvivorAmongAbsorbed,
  SourceKeyOwnedByAnotherProject,
} from './errors.js';
import {
  attachSourceKey,
  mergeProjects,
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
const ALREADY_ABSORBED_ID = 'PRJ-EF56-GH78';

describe('registerProject', () => {
  it('creates an active project that carries its initial source key', () => {
    const { project } = registerProject(REGISTRATION, PROJECT_ID);

    expect(project).toEqual({
      id: PROJECT_ID,
      label: REGISTRATION.label,
      ownerSiren: REGISTRATION.ownerSiren,
      status: 'ACTIVE',
      mergedInto: null,
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

describe('mergeProjects', () => {
  const survivor = REGISTERED_PROJECT;
  const absorbed: Project = {
    ...REGISTERED_PROJECT,
    id: OTHER_PROJECT_ID,
    sourceKeys: [NEW_SOURCE_KEY],
  };

  it('closes the absorbed projects and describes the merge in a ProjectsMerged event', () => {
    const merger = mergeProjects(survivor, [absorbed]);

    expect(merger).toEqual({
      absorbed: [
        {
          ...absorbed,
          status: 'MERGED',
          mergedInto: PROJECT_ID,
          sourceKeys: [],
        },
      ],
      event: {
        type: 'ProjectsMerged',
        projectIds: [PROJECT_ID, OTHER_PROJECT_ID],
        payload: {
          survivor: PROJECT_ID,
          absorbed: [OTHER_PROJECT_ID],
          transferredSourceKeys: [NEW_SOURCE_KEY],
        },
      },
    });
  });

  const alreadyAbsorbed: Project = {
    ...REGISTERED_PROJECT,
    id: ALREADY_ABSORBED_ID,
    status: 'MERGED',
    mergedInto: PROJECT_ID,
    sourceKeys: [],
  };

  it('changes nothing when every project is already merged into the survivor', () => {
    expect(mergeProjects(survivor, [alreadyAbsorbed])).toEqual({
      absorbed: [],
      event: null,
    });
  });

  it('absorbs only the projects not yet merged into the survivor', () => {
    const merger = mergeProjects(survivor, [alreadyAbsorbed, absorbed]);

    expect(merger.absorbed.map(({ id }) => id)).toEqual([OTHER_PROJECT_ID]);
    expect(merger.event?.payload.absorbed).toEqual([OTHER_PROJECT_ID]);
  });

  it.each(['MERGED', 'SPLIT'] as const)(
    'rejects a merge into a %s survivor',
    (status) => {
      expect(() => mergeProjects({ ...survivor, status }, [absorbed])).toThrow(
        ProjectNotActive,
      );
    },
  );

  it('rejects a project merged into another project', () => {
    expect(() =>
      mergeProjects(survivor, [
        { ...alreadyAbsorbed, mergedInto: OTHER_PROJECT_ID },
      ]),
    ).toThrow(ProjectNotActive);
  });

  it('rejects a split project', () => {
    expect(() =>
      mergeProjects(survivor, [{ ...absorbed, status: 'SPLIT' }]),
    ).toThrow(ProjectNotActive);
  });

  it('rejects a survivor among the absorbed projects, before checking any status', () => {
    const closedSurvivor: Project = { ...survivor, status: 'MERGED' };

    expect(() =>
      mergeProjects(closedSurvivor, [absorbed, closedSurvivor]),
    ).toThrow(SurvivorAmongAbsorbed);
  });
});
