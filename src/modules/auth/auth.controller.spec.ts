import { createMock } from '@golevelup/ts-jest';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { UsersService } from '../users/users.service.js';

describe('Auth response boundaries', () => {
  const auth = createMock<AuthService>();
  const users = createMock<UsersService>();
  const controller = new AuthController(auth, users);
  const user: User = {
    id: 'user',
    email: 'test@example.com',
    passwordHash: 'hash',
    firstName: 'Test',
    lastName: 'User',
    isVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const tokens = {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 900,
  };
  beforeEach(() => {
    jest.resetAllMocks();
  });
  it('uses the public user projection for register, login, refresh and profile responses', async () => {
    users.toPublic.mockReturnValue({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isVerified: false,
      createdAt: user.createdAt,
    });
    auth.register.mockResolvedValue(user);
    auth.login.mockResolvedValue({ user, tokens });
    auth.refresh.mockResolvedValue({ user, tokens });
    users.findById.mockResolvedValue(user);
    expect(
      await controller.register({
        email: user.email,
        password: 'password',
        firstName: 'Test',
        lastName: 'User',
      }),
    ).not.toHaveProperty('passwordHash');
    for (const agent of ['test-agent', undefined]) {
      const request = createMock<Request>({
        headers: { 'user-agent': agent },
        ip: '127.0.0.1',
      });
      expect(
        (
          await controller.login(
            { email: user.email, password: 'password' },
            request,
          )
        ).tokens,
      ).toEqual(tokens);
      expect(
        (await controller.refresh({ refreshToken: 'refresh' }, request)).tokens,
      ).toEqual(tokens);
    }
    expect(
      await controller.me({ id: user.id, email: user.email }),
    ).not.toHaveProperty('passwordHash');
  });
  it('returns 404 for a deleted user and revokes the specified sessions', async () => {
    users.findById.mockResolvedValue(null);
    await expect(
      controller.me({ id: user.id, email: user.email }),
    ).rejects.toThrow('User not found');
    await controller.logout({ refreshToken: 'refresh' });
    await controller.logoutAll(user.id);
    expect(auth.logout).toHaveBeenCalledWith('refresh');
    expect(auth.logoutAll).toHaveBeenCalledWith(user.id);
  });
});
