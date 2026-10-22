import { Module } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DATABASE, type Database } from '../database/database.module.js';
import { ProjectsController } from './api/projects.controller.js';
import { AttachSourceKey } from './application/attach-source-key.js';
import { GetProject } from './application/get-project.js';
import {
  PROJECT_ID_GENERATOR,
  RegisterProject,
  type ProjectIdGenerator,
} from './application/register-project.js';
import { UNIT_OF_WORK } from './application/unit-of-work.js';
import { generateProjectId } from './domain/project-id.js';
import { DrizzleUnitOfWork } from './infrastructure/drizzle-unit-of-work.js';

@Module({
  controllers: [ProjectsController],
  providers: [
    RegisterProject,
    GetProject,
    AttachSourceKey,
    {
      provide: UNIT_OF_WORK,
      inject: [DATABASE],
      useFactory: (db: Database) => new DrizzleUnitOfWork(db),
    },
    {
      provide: PROJECT_ID_GENERATOR,
      useValue: (() => generateProjectId(randomBytes)) as ProjectIdGenerator,
    },
  ],
})
export class ProjectsModule {}
