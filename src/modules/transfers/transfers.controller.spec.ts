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
      controller.create(user, { receiverWalletId: 'wallet', amount: 500 }, ''),
    ).rejects.toThrow('Idempotency-Key');
    expect(service.executeTransfer).not.toHaveBeenCalled();
  });
  it('passes authenticated identity and default pagination to the service', async () => {
    service.executeTransfer.mockResolvedValue(
      createMock<Awaited<ReturnType<TransfersService['executeTransfer']>>>(),
    );
    service.findAllForUser.mockResolvedValue({
      data: [],
      pagination: { nextCursor: null, hasNextPage: false, limit: 20 },
    });
    await controller.create(
      user,
      { receiverWalletId: 'wallet', amount: 500 },
      'key',
    );
    await controller.findAll(user);
    await controller.findOne('id', user);
    expect(service.executeTransfer).toHaveBeenCalledWith(
      user.id,
      { receiverWalletId: 'wallet', amount: 500 },
      'key',
    );
    expect(service.findAllForUser).toHaveBeenCalledWith(user.id, 20, undefined);
    expect(service.findOneForUser).toHaveBeenCalledWith('id', user.id);
  });
});
