import { SourceKeyAlreadyRegistered } from './errors.js';
import {
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
  const existing: Project = {
    ...registerProject(REGISTRATION, PROJECT_ID).project,
    createdAt: new Date('2026-10-21T17:00:00.000Z'),
  };

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
