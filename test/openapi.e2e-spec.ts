import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './support/test-app.js';

const OPENAPI_JSON_PATH = '/docs-json';
const PROBLEM_DETAILS_SCHEMA = '#/components/schemas/ProblemDetailsResponse';

describe('OpenAPI specification', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is served as JSON on /docs-json', async () => {
    const response = await request(app.getHttpServer()).get(OPENAPI_JSON_PATH);

    expect(response.status).toBe(200);
    expect(response.body.openapi).toMatch(/^3\./);
    expect(response.body.info.title).toBe('API Immatriculation des projets');
    expect(response.body.paths).toHaveProperty('/health');
  });

  it('documents the event log listing, its cursor parameters and its validation problem', async () => {
    const { body } = await request(app.getHttpServer()).get(OPENAPI_JSON_PATH);
    const operation = body.paths['/v1/events'].get;

    const parameterNames = operation.parameters.map(
      ({ name }: { name: string }) => name,
    );
    expect(parameterNames.sort()).toEqual(['after', 'limit']);
    expect(Object.keys(operation.responses).sort()).toEqual(['200', '400']);
    expect(
      operation.responses['400'].content['application/problem+json'].schema,
    ).toEqual({ $ref: PROBLEM_DETAILS_SCHEMA });
  });

  it('documents the registration, its replay and its problems', async () => {
    const { body } = await request(app.getHttpServer()).get(OPENAPI_JSON_PATH);
    const operation = body.paths['/v1/projects'].post;

    expect(operation.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/RegisterProjectRequest',
    });
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '201',
      '400',
      '409',
    ]);
    for (const status of ['200', '201']) {
      expect(
        operation.responses[status].content['application/json'].schema,
      ).toEqual({ $ref: '#/components/schemas/ProjectResponse' });
    }
    for (const status of ['400', '409']) {
      expect(
        operation.responses[status].content['application/problem+json'].schema,
      ).toEqual({ $ref: PROBLEM_DETAILS_SCHEMA });
    }
  });

  it('documents the project lookup and its missing project problem', async () => {
    const { body } = await request(app.getHttpServer()).get(OPENAPI_JSON_PATH);
    const operation = body.paths['/v1/projects/{id}'].get;
    const idPattern = new RegExp(operation.parameters[0].schema.pattern);

    expect(idPattern.test('PRJ-7KQ2-M9XD')).toBe(true);
    expect(idPattern.test('PRJ-7KQ2-M9XI')).toBe(false);

    expect(Object.keys(operation.responses).sort()).toEqual(['200', '404']);
    expect(
      operation.responses['200'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/ProjectResponse' });
    expect(
      operation.responses['404'].content['application/problem+json'].schema,
    ).toEqual({ $ref: PROBLEM_DETAILS_SCHEMA });
  });

  it('serves the interactive documentation on /docs', async () => {
    const response = await request(app.getHttpServer()).get('/docs');

    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger-ui');
  });
});
