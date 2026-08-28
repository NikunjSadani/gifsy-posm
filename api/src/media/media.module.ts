import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';

/**
 * Exposes the auth-gated media-view route (`GET /v1/media/view`). PosmMediaService is provided
 * by the @Global CaptureModule, so no import is needed here.
 */
@Module({
  controllers: [MediaController],
})
export class MediaModule {}
