import { registerAs } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';

export default registerAs('redis', (): ConnectionOptions => {
  const url = process.env.REDIS_URL
    ? new URL(process.env.REDIS_URL)
    : undefined;
  const host = url?.hostname ?? process.env.REDIS_HOST ?? 'localhost';
  return {
    host,
    port: Number(url?.port || process.env.REDIS_PORT || 6379),
    ...(url?.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url?.password || process.env.REDIS_PASSWORD
      ? {
          password: url?.password
            ? decodeURIComponent(url.password)
            : process.env.REDIS_PASSWORD,
        }
      : {}),
    ...(url?.pathname && url.pathname !== '/'
      ? { db: Number(url.pathname.slice(1)) }
      : {}),
    ...(url?.protocol === 'rediss:' ||
    process.env.REDIS_TLS === 'true' ||
    host.toLowerCase().endsWith('.upstash.io')
      ? { tls: { servername: host } }
      : {}),
    connectTimeout: 10000,
  };
});
