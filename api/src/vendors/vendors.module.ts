import { Module } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';

/**
 * Vendor master module. PrismaModule is @Global, so no imports are needed.
 * Wire into AppModule.imports at integration.
 */
@Module({
  controllers: [VendorsController],
  providers: [VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
