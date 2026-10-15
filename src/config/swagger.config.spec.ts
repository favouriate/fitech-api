import { createMock } from '@golevelup/ts-jest';
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { setupSwagger } from './swagger.config.js';

@Controller('sample')
class SampleController {
  @Get() get(): string {
    return 'ok';
  }
}

describe('Swagger exposure', () => {
  it.each(['development', 'production'])(
    'exposes documentation only outside production (%s)',
    async (environment) => {
      const module = await Test.createTestingModule({
        controllers: [SampleController],
      }).compile();
      const app = module.createNestApplication();
      const config = createMock<ConfigService>();
      const get = createMock<{ read: jest.Mock }>().read;
      config.get = get;
      get.mockReturnValue(environment);
      try {
        setupSwagger(app, config);
        await app.init();
        await request(app.getHttpServer())
          .get('/docs-json')
          .expect(environment === 'production' ? 404 : 200);
      } finally {
        await app.close();
      }
    },
  );
});
