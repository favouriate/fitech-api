import { registerAs } from '@nestjs/config';

export const AUTH_THROTTLE_LIMIT = 5;
export const AUTH_THROTTLE_TTL = 60_000;

export default registerAs('throttler', () => ({
  throttlers: [
    { name: 'short', ttl: 1_000, limit: 10 },
    { name: 'medium', ttl: 60_000, limit: 100 },
    { name: 'long', ttl: 3_600_000, limit: 1_000 },
    {
      name: 'auth',
      ttl: AUTH_THROTTLE_TTL,
      limit: AUTH_THROTTLE_LIMIT,
    },
  ],
}));
