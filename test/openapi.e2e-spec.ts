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

  it('documents the source key attachment, its replay and its problems', async () => {
    const { body } = await request(app.getHttpServer()).get(OPENAPI_JSON_PATH);
    const operation = body.paths['/v1/projects/{id}/source-keys'].post;

    expect(operation.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/SourceKeyRequest',
    });
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '201',
      '400',
      '404',
      '409',
    ]);
    for (const status of ['200', '201']) {
      expect(
        operation.responses[status].content['application/json'].schema,
      ).toEqual({ $ref: '#/components/schemas/ProjectResponse' });
      expect(operation.responses[status].headers).toHaveProperty(
        'Content-Location',
      );
    }
    for (const status of ['400', '404', '409']) {
      expect(
        operation.responses[status].content['application/problem+json'].schema,
      ).toEqual({ $ref: PROBLEM_DETAILS_SCHEMA });
    }
  });

  it('documents the merge, its absorbed list and its problems', async () => {
    const { body } = await request(app.getHttpServer()).get(OPENAPI_JSON_PATH);
    const operation = body.paths['/v1/projects/{id}/merges'].post;
    const absorbed =
      body.components.schemas.MergeProjectsRequest.properties.absorbed;

    expect(operation.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/MergeProjectsRequest',
    });
    expect(absorbed).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    });
    expect(new RegExp(absorbed.items.pattern).test('PRJ-7KQ2-M9XD')).toBe(true);
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '404',
      '409',
      '422',
    ]);
    expect(
      operation.responses['200'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/ProjectResponse' });
    expect(operation.responses['200'].headers).toHaveProperty(
      'Content-Location',
    );
    for (const status of ['400', '404', '409', '422']) {
      expect(
        operation.responses[status].content['application/problem+json'].schema,
      ).toEqual({ $ref: PROBLEM_DETAILS_SCHEMA });
    }
  });

  it('documents the split, its replay and its problems', async () => {
    const { body } = await request(app.getHttpServer()).get(OPENAPI_JSON_PATH);
    const operation = body.paths['/v1/projects/{id}/splits'].post;
    const { schemas } = body.components;

    expect(operation.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/SplitProjectRequest',
    });
    expect(schemas.SplitProjectRequest.properties.successors).toMatchObject({
      type: 'array',
      minItems: 2,
      maxItems: 20,
    });
    expect(Object.keys(schemas.SuccessorRequest.properties).sort()).toEqual([
      'label',
      'ownerSiren',
      'sourceKeys',
    ]);
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '201',
      '400',
      '404',
      '409',
      '422',
    ]);
    for (const status of ['200', '201']) {
      expect(
        operation.responses[status].content['application/json'].schema,
      ).toEqual({ $ref: '#/components/schemas/SplitResponse' });
    }
    for (const status of ['400', '404', '409', '422']) {
      expect(
        operation.responses[status].content['application/problem+json'].schema,
      ).toEqual({ $ref: PROBLEM_DETAILS_SCHEMA });
    }
  });

  it('documents the links of a split project to its successors', async () => {
    const { body } = await request(app.getHttpServer()).get(OPENAPI_JSON_PATH);
    const project = body.components.schemas.ProjectResponse;

    expect(project.required).toContain('splitInto');
    expect(project.properties.splitInto).toMatchObject({
      type: 'array',
      nullable: true,
    });
  });

  it('documents the link of a merged project to its survivor', async () => {
    const { body } = await request(app.getHttpServer()).get(OPENAPI_JSON_PATH);
    const project = body.components.schemas.ProjectResponse;

    expect(project.required).toContain('mergedInto');
    expect(project.properties.mergedInto).toMatchObject({
      type: 'string',
      nullable: true,
    });
  });

  it('serves the interactive documentation on /docs', async () => {
    const response = await request(app.getHttpServer()).get('/docs');

    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger-ui');
  });
});
