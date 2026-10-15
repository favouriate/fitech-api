import { createMock } from '@golevelup/ts-jest';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  const prisma = createMock<PrismaService>();
  const service = new UsersService(prisma);
  const user: User = {
    id: 'user',
    email: 'ada@example.com',
    passwordHash: 'hash',
    firstName: 'Ada',
    lastName: 'User',
    isVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  beforeEach(() => {
    jest.resetAllMocks();
  });
  it('normalizes lookup email and looks up user IDs', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    expect(await service.findByEmail(' ADA@EXAMPLE.COM ')).toEqual(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'ada@example.com' },
    });
    expect(await service.findById('user')).toEqual(user);
  });
  it('normalizes new user email and excludes password hashes from public users', async () => {
    prisma.user.create.mockResolvedValue(user);
    await service.create({
      email: ' ADA@EXAMPLE.COM ',
      passwordHash: 'hash',
      firstName: 'Ada',
      lastName: 'User',
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'ada@example.com' }),
    });
    expect(service.toPublic(user)).not.toHaveProperty('passwordHash');
  });
  it('handles duplicate races and propagates database failures', async () => {
    const input = {
      email: user.email,
      passwordHash: 'hash',
      firstName: 'Ada',
      lastName: 'User',
    };
    prisma.user.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce(new Error('database offline'));
    await expect(service.create(input)).rejects.toThrow(
      'An account with this email already exists',
    );
    await expect(service.create(input)).rejects.toThrow('database offline');
  });
});
