import { Controller, Get, Res } from '@nestjs/common';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';

@Public()
@Controller('metrics')
export class MetricsController extends PrometheusController {
  @Get()
  @Public()
  override index(
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    return super.index(response);
  }
}
