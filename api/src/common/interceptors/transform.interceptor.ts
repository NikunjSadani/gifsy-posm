import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps every successful controller return value in the platform's standard
 * success envelope: `{ success: true, data }`.
 *
 * This is the backend half of the contract the web frontend's api-client expects
 * (`{ success: true, data }` / `{ success: false, error }`). Controllers just
 * return their data; the envelope is applied globally.
 *
 * Exception: binary/file responses (`StreamableFile` — used for xlsx/report
 * downloads) are passed through UNWRAPPED, so the download isn't corrupted by the
 * JSON envelope.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => (data instanceof StreamableFile ? data : { success: true, data })),
    );
  }
}
