import { createMock } from '@golevelup/ts-jest';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';

describe('JwtAuthGuard', () => {
  const jwt = createMock<JwtService>();
  const config = createMock<ConfigService>();
  const getOrThrow = createMock<{ read: jest.Mock }>().read;
  config.getOrThrow = getOrThrow;
  const reflector = createMock<Reflector>();
  const guard = new JwtAuthGuard(jwt, config, reflector);
  const context = createMock<ExecutionContext>();
  beforeEach(() => {
    jest.resetAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);
    getOrThrow.mockReturnValue('test-secret');
  });
  it('allows public routes without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(await guard.canActivate(context)).toBe(true);
  });
  it.each([undefined, '', 'Basic token', 'Bearer ', 'Bearer one two'])(
    'rejects missing or malformed authorization %s',
    async (authorization) => {
      context
        .switchToHttp()
        .getRequest.mockReturnValue({ headers: { authorization } });
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing access token',
      );
    },
  );
  it('rejects invalid tokens and malformed claims', async () => {
    context.switchToHttp().getRequest.mockReturnValue({
      headers: { authorization: 'Bearer token' },
    });
    jwt.verifyAsync.mockRejectedValueOnce(new Error('signature failed'));
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired access token',
    );
    for (const payload of [
      {},
      { sub: '', email: 'a@example.com' },
      { sub: 'id', email: '' },
    ]) {
      jwt.verifyAsync.mockResolvedValueOnce(payload);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid or expired access token',
      );
    }
  });
  it('injects the authenticated user on valid requests', async () => {
    const request: {
      headers: { authorization: string };
      user?: { id: string; email: string };
    } = { headers: { authorization: 'Bearer token' } };
    context.switchToHttp().getRequest.mockReturnValue(request);
    jwt.verifyAsync.mockResolvedValue({ sub: 'id', email: 'a@example.com' });
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({ id: 'id', email: 'a@example.com' });
  });
});
