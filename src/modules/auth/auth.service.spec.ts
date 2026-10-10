import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';

const PASSWORD = 'Str0ng!Passw0rd';
const user = {
  id: 'user-id',
  email: 'ada@example.com',
  passwordHash: '',
  firstName: 'Ada',
  lastName: 'Okafor',
  isVerified: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('AuthService', () => {
  let service: AuthService;
  let moduleRef: TestingModule;

  const prisma = {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const users = {
    create: vi.fn(),
    findByEmail: vi.fn(),
  };
  const jwt = {
    signAsync: vi.fn().mockResolvedValue('signed-access-token'),
  };
  const config = {
    getOrThrow: vi.fn((key: string) => {
      const values: Record<string, string> = {
        'jwt.accessSecret': 'test-secret-at-least-32-characters-long',
        'jwt.accessExpiresIn': '15m',
        'jwt.refreshExpiresIn': '7d',
      };
      return values[key];
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    users.create.mockImplementation(async (data) => ({ ...user, ...data }));
    users.findByEmail.mockResolvedValue({
      ...user,
      passwordHash: await argon2.hash(PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
    });
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));

    moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('stores a password hash rather than the submitted password', async () => {
    await service.register({
      email: 'ADA@example.com',
      password: PASSWORD,
      firstName: ' Ada ',
      lastName: ' Okafor ',
    });

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ADA@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
      }),
    );
    const [createInput] = users.create.mock.calls[0] as [
      { passwordHash: string },
    ];
    expect(createInput.passwordHash).not.toBe(PASSWORD);
    await expect(
      argon2.verify(createInput.passwordHash, PASSWORD),
    ).resolves.toBe(true);
  });

  it('returns the same login error for unknown accounts and bad passwords', async () => {
    users.findByEmail.mockResolvedValueOnce(null);
    await expect(
      service.login({ email: 'missing@example.com', password: PASSWORD }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      service.login({ email: user.email, password: 'Incorrect!Password1' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues an access token and persists only a hash of the refresh token', async () => {
    const result = await service.login(
      { email: user.email, password: PASSWORD },
      { userAgent: 'test-agent', ipAddress: '127.0.0.1' },
    );

    expect(result.tokens.accessToken).toBe('signed-access-token');
    expect(result.tokens.expiresIn).toBe(900);
    expect(result.tokens.refreshToken).toHaveLength(128);
    const [createInput] = prisma.refreshToken.create.mock.calls[0] as [
      { data: { tokenHash: string; userAgent: string; ipAddress: string } },
    ];
    expect(createInput.data.tokenHash).not.toBe(result.tokens.refreshToken);
    expect(createInput.data.tokenHash).toBe(
      createHash('sha256').update(result.tokens.refreshToken).digest('hex'),
    );
    expect(createInput.data.userAgent).toBe('test-agent');
    expect(createInput.data.ipAddress).toBe('127.0.0.1');
  });

  it('rotates a refresh token atomically and revokes sessions on token reuse', async () => {
    const refreshToken = 'a'.repeat(128);
    const storedToken = {
      id: 'refresh-token-id',
      userId: user.id,
      user,
      tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      userAgent: null,
      ipAddress: null,
      createdAt: new Date(),
    };
    prisma.refreshToken.findUnique.mockResolvedValueOnce(storedToken);

    const rotated = await service.refresh(refreshToken, {});
    expect(rotated.user.id).toBe(user.id);
    expect(rotated.tokens.refreshToken).toHaveLength(128);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: storedToken.id,
          revokedAt: null,
        }),
      }),
    );

    prisma.refreshToken.findUnique.mockResolvedValueOnce({
      ...storedToken,
      revokedAt: new Date(),
    });
    await expect(service.refresh(refreshToken, {})).rejects.toThrow(
      'Refresh token reuse detected',
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: user.id, revokedAt: null },
      }),
    );
  });
});
