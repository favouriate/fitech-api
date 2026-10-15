import { Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  CanActivate,
  ExecutionContext,
  RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service.js';

/** Guards run before global pipes, so unsigned payloads are never DTO-validated. */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(private readonly webhooks: WebhooksService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const signature = request.headers['x-webhook-signature'];
    if (
      typeof signature !== 'string' ||
      !this.webhooks.verifySignature(request.rawBody, signature)
    ) {
      throw new UnauthorizedException('Invalid signature');
    }
    return true;
  }
}
