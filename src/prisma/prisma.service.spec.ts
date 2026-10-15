import { createMock } from '@golevelup/ts-jest';
import { PrismaService } from './prisma.service.js';

describe('Prisma lifecycle', () => {
  it('connects, performs readiness queries and disconnects', async () => {
    const service = new PrismaService();
    const operations = createMock<{
      connect: jest.Mock;
      disconnect: jest.Mock;
      query: jest.Mock;
    }>();
    service.$connect = operations.connect;
    service.$disconnect = operations.disconnect;
    service.$queryRaw = operations.query;
    await service.onModuleInit();
    await service.ping();
    await service.onModuleDestroy();
    expect(operations.connect).toHaveBeenCalledTimes(1);
    expect(operations.query).toHaveBeenCalledTimes(1);
    expect(operations.disconnect).toHaveBeenCalledTimes(1);
  });
});
