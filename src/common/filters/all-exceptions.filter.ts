import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import type { Request, Response } from 'express';
import { routeLabel } from '../../modules/metrics/metrics.interceptor.js';

@Catch()
export class AllExceptionsFilter extends SentryGlobalFilter {
  constructor(
    adapterHost: HttpAdapterHost,
    private readonly errorLogger: Logger,
    @InjectMetric('http_errors_total')
    private readonly errors: Counter<'method' | 'route' | 'status_code'>,
  ) {
    super(adapterHost.httpAdapter);
  }

  @SentryExceptionCaptured()
  override catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    let message: string | string[] = 'Internal server error';
    if (typeof body === 'string') message = body;
    else if (typeof body === 'object' && body !== null && 'message' in body) {
      const value: unknown = body.message;
      if (
        typeof value === 'string' ||
        (Array.isArray(value) &&
          value.every((item: unknown) => typeof item === 'string'))
      ) {
        message = value;
      }
    }
    const route = routeLabel(request);
    this.errors.inc({
      method: request.method,
      route,
      status_code: String(status),
    });
    if (status >= 500)
      this.errorLogger.error(
        `${request.method} ${route} returned ${status}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    else this.errorLogger.warn(`${request.method} ${route} returned ${status}`);
    if (!response.headersSent) {
      response.status(status).json({
        statusCode: status,
        message,
        timestamp: new Date().toISOString(),
        path: request.path,
      });
    }
  }
}
