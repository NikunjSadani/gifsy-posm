import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';

/**
 * Human-login admin module. Imports AuthModule to inject AuthService — deactivate must call
 * invalidateAllSessions to evict a disabled login immediately. PrismaModule is @Global.
 * Wire into AppModule.imports at integration.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
