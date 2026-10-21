import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
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
import { GetProject } from '../application/get-project.js';
import { RegisterProject } from '../application/register-project.js';
import { PROJECT_ID_PATTERN } from '../domain/project-id.js';
import { ProjectResponse, toProjectResponse } from './project.response.js';
import { RegisterProjectRequest } from './register-project.request.js';

const PROJECTS_PATH = '/v1/projects';

@ApiTags('projects')
@Controller({ path: 'projects', version: '1' })
export class ProjectsController {
  constructor(
    private readonly registerProject: RegisterProject,
    private readonly getProject: GetProject,
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

  @Get(':id')
  @ApiOperation({
    summary: 'Get a project by its registration id',
    description: 'Projects remain readable whatever their status.',
  })
  @ApiParam({
    name: 'id',
    description:
      'Registration id; a malformed id is reported as a missing project',
    example: 'PRJ-7KQ2-M9XD',
    schema: { type: 'string', pattern: PROJECT_ID_PATTERN },
  })
  @ApiOkResponse({ type: ProjectResponse })
  @ApiProblemResponse(HttpStatus.NOT_FOUND, 'No project has this id')
  async get(@Param('id') id: string): Promise<ProjectResponse> {
    return toProjectResponse(await this.getProject.execute(id));
  }
}
