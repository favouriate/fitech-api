import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: vi.fn(),
        $disconnect: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue(1),
        ping: vi.fn().mockResolvedValue(undefined),
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'e2e-user',
            email: 'ada@example.com',
            passwordHash: 'must-not-be-returned',
            firstName: 'Ada',
            lastName: 'Okafor',
            isVerified: false,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  it('requires an access token for protected auth routes', () => {
    return request(app.getHttpServer()).get('/v1/auth/me').expect(401);
  });

  it('authenticates protected routes and returns only public user fields', async () => {
    const accessToken = await app
      .get(JwtService)
      .signAsync({ sub: 'e2e-user', email: 'ada@example.com' });

    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect({
        id: 'e2e-user',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
        isVerified: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
  });

  it('allows public auth routes to reach request validation', () => {
    return request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({})
      .expect(400);
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200);
  });

  afterEach(async () => {
    await app.close();
  });
});
