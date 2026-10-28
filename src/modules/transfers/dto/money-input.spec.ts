import { ValidationPipe } from '@nestjs/common';
import { CreateTransferDto } from './create-transfer.dto.js';
import { InitiateFundingDto } from '../../funding/dto/initiate-funding.dto.js';

describe.each([CreateTransferDto, InitiateFundingDto])(
  '%s money input',
  (Dto) => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const body = (amount: unknown) => ({
      amount,
      ...(Dto === CreateTransferDto
        ? { receiverWalletId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
        : {}),
    });

    it.each(['1', '500.1234', '999999999999999.9999'])(
      'preserves the exact input string %s',
      async (amount) => {
        const result = await pipe.transform(body(amount), {
          type: 'body',
          metatype: Dto,
        });
        expect(result.amount).toBe(amount);
      },
    );

    it.each([
      500,
      500.1234,
      null,
      undefined,
      '',
      '01',
      '1e3',
      '-1',
      '.5',
      '1.',
      '1.00001',
      '1000000000000000',
      'Infinity',
      'NaN',
    ])('rejects numeric or malformed input %s', async (amount) => {
      await expect(
        pipe.transform(body(amount), {
          type: 'body',
          metatype: Dto,
        }),
      ).rejects.toThrow();
    });
  },
);
