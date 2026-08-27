import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()   // Available in every module without re-importing
@Module({
  providers: [PrismaService],
  exports:   [PrismaService],
})
export class PrismaModule {}
