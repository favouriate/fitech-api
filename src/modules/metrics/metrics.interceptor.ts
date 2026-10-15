import { Injectable } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Request, Response } from 'express';
import { Histogram } from 'prom-client';
import type { Observable } from 'rxjs';

export function routeLabel(request: Request): string {
  const route: unknown = request.route;
  if (
    typeof route === 'object' &&
    route !== null &&
    'path' in route &&
    typeof route.path === 'string'
  ) {
    return `${request.baseUrl}${route.path}`;
  }
  return request.path;
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric('http_server_requests_seconds')
    private readonly histogram: Histogram<'method' | 'route' | 'status_code'>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const started = process.hrtime.bigint();
    // finish occurs after exception filters set the final HTTP status.
    response.once('finish', () => {
      this.histogram.observe(
        {
          method: request.method,
          route: routeLabel(request),
          status_code: String(response.statusCode),
        },
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    });
    return next.handle();
  }
}
