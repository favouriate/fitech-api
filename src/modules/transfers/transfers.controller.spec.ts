import { Prisma } from '@prisma/client';
import { createMock } from '@golevelup/ts-jest';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

describe('Transfer API boundaries', () => {
  const service = createMock<TransfersService>();
  const controller = new TransfersController(service);
  const user = { id: 'user', email: 'user@example.com' };
  beforeEach(() => {
    jest.resetAllMocks();
  });
  it('rejects empty idempotency keys before executing transfers', async () => {
    await expect(
      controller.create(
        user,
        { receiverWalletId: 'wallet', amount: '500' },
        '',
      ),
    ).rejects.toThrow('Idempotency-Key');
    expect(service.executeTransfer).not.toHaveBeenCalled();
  });
  it('passes authenticated identity and default pagination to the service', async () => {
    const transfer = {
      ...createMock<Awaited<ReturnType<TransfersService['executeTransfer']>>>(),
      amount: new Prisma.Decimal('500.1234'),
    };
    service.executeTransfer.mockResolvedValue(transfer);
    service.findOneForUser.mockResolvedValue(transfer);
    service.findAllForUser.mockResolvedValue({
      data: [],
      pagination: { nextCursor: null, hasNextPage: false, limit: 20 },
    });
    await controller.create(
      user,
      { receiverWalletId: 'wallet', amount: '500' },
      'key',
    );
    await controller.findAll(user);
    expect((await controller.findOne('id', user)).amount).toBe('500.1234');
    expect(service.executeTransfer).toHaveBeenCalledWith(
      user.id,
      { receiverWalletId: 'wallet', amount: '500' },
      'key',
    );
    expect(service.findAllForUser).toHaveBeenCalledWith(user.id, 20, undefined);
    expect(service.findOneForUser).toHaveBeenCalledWith('id', user.id);
  });
});
