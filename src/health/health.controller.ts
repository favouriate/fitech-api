import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('Health')
@Controller({
  path: 'health',
  version: VERSION_NEUTRAL,
})
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly healthIndicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Public()
  @SkipThrottle({ auth: true })
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness and readiness probe' })
  check() {
    return this.health.check([
      () =>
        this.healthIndicator
          .check('database')
          .attempt(() => this.prisma.ping())
          .withTimeout(1_000),
    ]);
  }
}
