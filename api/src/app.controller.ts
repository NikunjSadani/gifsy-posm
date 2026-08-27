import { Controller, Get, VERSION_NEUTRAL, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './common/decorators/roles.decorator';

@Controller({ version: VERSION_NEUTRAL })
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * GET /health — liveness probe used by Cloud Run and load balancers. Must be @Public.
   */
  @Get('health')
  @Public()
  health(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * GET /health/ready — readiness probe. Depends on the DB: a running container that can't
   * reach Postgres should be pulled out of the serving pool. Returns 503 when the DB is down.
   */
  @Get('health/ready')
  @Public()
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready', db: 'down' });
    }
  }
}
