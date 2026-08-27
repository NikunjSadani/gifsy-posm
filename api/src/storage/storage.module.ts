import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Global so any domain (capture media, report exports) can inject StorageService. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
