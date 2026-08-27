import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Formats every thrown exception as the platform's standard error envelope:
 * `{ success: false, error }` with the correct HTTP status.
 *
 * Controllers/services just `throw new BadRequestException('...')` (etc.) and the
 * shape the frontend's api-client expects is produced here, globally.
 *
 * - `HttpException` → its status + message (class-validator arrays are joined).
 * - Anything else  → 500 + a generic message (real error logged, not leaked).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        error = body;
      } else {
        // Nest/class-validator shape: { statusCode, message, error }
        const msg = (body as { message?: string | string[]; error?: string }).message;
        error = Array.isArray(msg) ? msg.join(', ') : (msg ?? (body as { error?: string }).error ?? 'Error');
      }
    } else {
      // Unexpected error — log the real thing, return a safe generic message.
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({ success: false, error });
  }
}
