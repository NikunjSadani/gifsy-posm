import { NestFactory }           from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { ConfigService }          from '@nestjs/config';
import helmet                     from 'helmet';
import { json, urlencoded }       from 'express';
import { Logger as PinoLogger }   from 'nestjs-pino';
import { AppModule }              from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // bodyParser:false → we install our own json/urlencoded parsers with a raised limit. The
  // Express default is 100 kB, which a large admin bulk-upload (site/vendor master — hundreds
  // of rows of JSON) exceeds. Cloud Run caps the request at 32 MB, so 25 MB is a safe ceiling.
  // Multipart file uploads are unaffected (multer parses those independently).
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Structured logging — route all Nest logs through nestjs-pino so framework + application
  // logs share one JSON stream. flushLogs() drains buffered bootstrap logs before serving.
  app.useLogger(app.get(PinoLogger));
  app.flushLogs();

  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // URI versioning — feature controllers serve under /v1 (default version). AppController
  // (/, /health) is VERSION_NEUTRAL so liveness probes stay unversioned.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const config = app.get(ConfigService);

  // ── Security headers (Helmet) ────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ────────────────────────────────────────────────────────────────
  // Allow the configured frontend origin(s). Set CORS_ORIGINS in .env (comma-separated).
  const rawOrigins = config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000';
  const allowedOrigins = rawOrigins.split(',').map((o) => o.trim());
  app.enableCors({
    origin:      allowedOrigins,
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // ── Global validation pipe ───────────────────────────────────────────────
  // whitelist:true strips unknown fields; forbidNonWhitelisted:true returns 400 instead of
  // silently stripping; transform + enableImplicitConversion coerce DTO types.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:              true,
      forbidNonWhitelisted:   true,
      transform:              true,
      transformOptions:       { enableImplicitConversion: true },
    }),
  );

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
  logger.log(`API listening on port ${port}`);
  logger.log(`CORS origins: ${allowedOrigins.join(', ')}`);
}

bootstrap();
