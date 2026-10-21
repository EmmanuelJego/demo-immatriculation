import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Shared by main.ts and the integration tests, so that tests exercise
// the exact HTTP pipeline that runs in production.
export function configureApp(app: INestApplication): void {
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  setUpOpenApi(app);
}

function setUpOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('API Immatriculation des projets')
    .setDescription(
      "Registre d'immatriculation unique des projets des collectivités",
    )
    .setVersion('1')
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, config),
  );
}
