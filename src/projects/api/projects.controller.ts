import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiProblemResponse } from '../../common/http/problem-details.response.js';
import { CursorPageQuery } from '../../common/pagination/cursor-page.query.js';
import {
  EventPageResponse,
  toEventPageResponse,
} from '../../events/api/event.response.js';
import { AttachSourceKey } from '../application/attach-source-key.js';
import { FindProjects } from '../application/find-projects.js';
import { GetProject } from '../application/get-project.js';
import { ListProjectEvents } from '../application/list-project-events.js';
import { MergeProjects } from '../application/merge-projects.js';
import { RegisterProject } from '../application/register-project.js';
import { SplitProject } from '../application/split-project.js';
import { PROJECT_ID_PATTERN } from '../domain/project-id.js';
import { FindProjectsQuery } from './find-projects.query.js';
import { MergeProjectsRequest } from './merge-projects.request.js';
import {
  ProjectListResponse,
  ProjectResponse,
  SplitResponse,
  toProjectResponse,
} from './project.response.js';
import {
  RegisterProjectRequest,
  SourceKeyRequest,
} from './register-project.request.js';
import { SplitProjectRequest } from './split-project.request.js';

const PROJECTS_PATH = '/v1/projects';

const CONTENT_LOCATION_HEADER = {
  'Content-Location': {
    description: 'URL of the project the body represents',
    schema: { type: 'string', example: '/v1/projects/PRJ-7KQ2-M9XD' },
  },
};

function ApiProjectIdParam(): MethodDecorator {
  return ApiParam({
    name: 'id',
    description:
      'Registration id; a malformed id is reported as a missing project',
    example: 'PRJ-7KQ2-M9XD',
    schema: { type: 'string', pattern: PROJECT_ID_PATTERN },
  });
}

@ApiTags('projects')
@Controller({ path: 'projects', version: '1' })
export class ProjectsController {
  constructor(
    private readonly registerProject: RegisterProject,
    private readonly getProject: GetProject,
    private readonly attachSourceKey: AttachSourceKey,
    private readonly mergeProjects: MergeProjects,
    private readonly splitProject: SplitProject,
    private readonly listProjectEvents: ListProjectEvents,
    private readonly findProjects: FindProjects,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Register a project',
    description:
      'Idempotent on the source key: sending again a registered source key with the same attributes returns the existing project.',
  })
  @ApiCreatedResponse({
    type: ProjectResponse,
    description: 'Project registered; `Location` points to it',
  })
  @ApiOkResponse({
    type: ProjectResponse,
    description:
      'Replay: the source key is already registered with the same attributes',
  })
  @ApiProblemResponse(HttpStatus.BAD_REQUEST, 'Invalid registration')
  @ApiProblemResponse(
    HttpStatus.CONFLICT,
    'The source key is already registered with other attributes',
  )
  async register(
    @Body() request: RegisterProjectRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProjectResponse> {
    const { project, created } = await this.registerProject.execute(request);
    response
      .status(created ? HttpStatus.CREATED : HttpStatus.OK)
      .location(`${PROJECTS_PATH}/${project.id}`);
    return toProjectResponse(project);
  }

  @Post(':id/source-keys')
  @ApiOperation({
    summary: 'Attach a source key to a project',
    description:
      'Idempotent: attaching again a key the project already has returns the project unchanged.',
  })
  @ApiProjectIdParam()
  @ApiCreatedResponse({
    type: ProjectResponse,
    description:
      'Key attached; the body is the project, as `Content-Location` states',
    headers: CONTENT_LOCATION_HEADER,
  })
  @ApiOkResponse({
    type: ProjectResponse,
    description: 'Replay: the project already has this key',
    headers: CONTENT_LOCATION_HEADER,
  })
  @ApiProblemResponse(HttpStatus.BAD_REQUEST, 'Invalid source key')
  @ApiProblemResponse(HttpStatus.NOT_FOUND, 'No project has this id')
  @ApiProblemResponse(
    HttpStatus.CONFLICT,
    'The key belongs to another project, or the project is no longer active',
  )
  async attach(
    @Param('id') id: string,
    @Body() request: SourceKeyRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProjectResponse> {
    const { project, attached } = await this.attachSourceKey.execute(
      id,
      request,
    );
    response
      .status(attached ? HttpStatus.CREATED : HttpStatus.OK)
      .setHeader('Content-Location', `${PROJECTS_PATH}/${project.id}`);
    return toProjectResponse(project);
  }

  @Post(':id/merges')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Absorb projects into the survivor `{id}`',
    description:
      'The absorbed projects become MERGED and point to the survivor, which takes their source keys. Idempotent: the projects already merged into the survivor are ignored, and if none is left the survivor is returned unchanged.',
  })
  @ApiProjectIdParam()
  @ApiOkResponse({
    type: ProjectResponse,
    description:
      'Projects absorbed, or already absorbed; the body is the survivor, as `Content-Location` states',
    headers: CONTENT_LOCATION_HEADER,
  })
  @ApiProblemResponse(
    HttpStatus.BAD_REQUEST,
    'Invalid list of absorbed projects',
  )
  @ApiProblemResponse(HttpStatus.NOT_FOUND, 'No project has the survivor id')
  @ApiProblemResponse(
    HttpStatus.CONFLICT,
    'The survivor or an absorbed project is no longer active',
  )
  @ApiProblemResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'The survivor is among the absorbed projects, or an absorbed project does not exist',
  )
  async merge(
    @Param('id') id: string,
    @Body() request: MergeProjectsRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProjectResponse> {
    const survivor = await this.mergeProjects.execute(id, request.absorbed);
    response.setHeader('Content-Location', `${PROJECTS_PATH}/${survivor.id}`);
    return toProjectResponse(survivor);
  }

  @Post(':id/splits')
  @ApiOperation({
    summary: 'Split the project `{id}` into new successors',
    description:
      'Each source key of the project goes to exactly one successor, which may also bring new keys. The project becomes SPLIT and lists its successors. Idempotent: the same split again returns the existing successors.',
  })
  @ApiProjectIdParam()
  @ApiCreatedResponse({
    type: SplitResponse,
    description: 'Project split into the successors created',
  })
  @ApiOkResponse({
    type: SplitResponse,
    description: 'Replay: the project is already split into these successors',
  })
  @ApiProblemResponse(HttpStatus.BAD_REQUEST, 'Invalid list of successors')
  @ApiProblemResponse(HttpStatus.NOT_FOUND, 'No project has this id')
  @ApiProblemResponse(
    HttpStatus.CONFLICT,
    'The project is no longer active or was split differently, or a new key belongs to another project',
  )
  @ApiProblemResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'A key is allocated to two successors, or a key of the project to none',
  )
  async split(
    @Param('id') id: string,
    @Body() request: SplitProjectRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SplitResponse> {
    const { source, successors, created } = await this.splitProject.execute(
      id,
      request.successors,
    );
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return {
      source: toProjectResponse(source),
      successors: successors.map(toProjectResponse),
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Find the project that owns a source key',
    description:
      'The project the key is attached to now: after a merge or a split, the project the key was transferred to. The list holds at most one project, and is empty when no project has the key.',
  })
  @ApiOkResponse({ type: ProjectListResponse })
  @ApiProblemResponse(HttpStatus.BAD_REQUEST, 'Invalid source key')
  async find(@Query() query: FindProjectsQuery): Promise<ProjectListResponse> {
    const projects = await this.findProjects.bySourceKey(query);
    return { data: projects.map(toProjectResponse) };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a project by its registration id',
    description: 'Projects remain readable whatever their status.',
  })
  @ApiProjectIdParam()
  @ApiOkResponse({ type: ProjectResponse })
  @ApiProblemResponse(HttpStatus.NOT_FOUND, 'No project has this id')
  async get(@Param('id') id: string): Promise<ProjectResponse> {
    return toProjectResponse(await this.getProject.execute(id));
  }

  @Get(':id/events')
  @ApiOperation({
    summary: 'List the history of a project in sequence order',
    description:
      'The events of the event log that concern the project, oldest first, whatever its status. Pass `pagination.nextAfter` as `after` to read the next page.',
  })
  @ApiProjectIdParam()
  @ApiOkResponse({ type: EventPageResponse })
  @ApiProblemResponse(HttpStatus.BAD_REQUEST, 'Invalid pagination parameters')
  @ApiProblemResponse(HttpStatus.NOT_FOUND, 'No project has this id')
  async events(
    @Param('id') id: string,
    @Query() query: CursorPageQuery,
  ): Promise<EventPageResponse> {
    return toEventPageResponse(await this.listProjectEvents.execute(id, query));
  }
}
