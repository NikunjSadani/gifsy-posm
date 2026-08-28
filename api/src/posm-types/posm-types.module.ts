import { Module } from '@nestjs/common';
import { PosmTypesService } from './posm-types.service';
import { PosmTypesController } from './posm-types.controller';

/**
 * PosmType master module. PrismaModule is @Global, so no imports are needed.
 * Wire into AppModule.imports at integration.
 */
@Module({
  controllers: [PosmTypesController],
  providers: [PosmTypesService],
  exports: [PosmTypesService],
})
export class PosmTypesModule {}
