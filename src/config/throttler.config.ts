import { registerAs } from '@nestjs/config';

export default registerAs('throttler', () => ({
  throttlers: [
    { name: 'short', ttl: 1_000, limit: 10 },
    { name: 'medium', ttl: 60_000, limit: 100 },
    { name: 'long', ttl: 3_600_000, limit: 1_000 },
  ],
  auth: { ttl: 60_000, limit: 5 },
}));
