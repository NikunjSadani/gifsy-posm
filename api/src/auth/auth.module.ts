import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaModule } from '../prisma/prisma.module';
import { ACCESS_TTL } from './auth.constants';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:      config.get('JWT_SECRET'),
        // Default access-token lifetime is the SHORT ACCESS_TTL (60m), not the 7-day session
        // window, so the rolling session actually rolls. Pin the signing algorithm to HS256
        // (the verify side pins algorithms:['HS256'] to match) so tokens are minted and
        // accepted under exactly one algorithm — no alg-confusion surface.
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') ?? ACCESS_TTL, algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers:   [AuthService, JwtStrategy],
  exports:     [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
