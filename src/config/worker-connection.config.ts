import type { ConnectionOptions } from 'bullmq';

export function getWorkerConnectionOptions(): ConnectionOptions {
  return {
    url: process.env.REDIS_URL,
    maxRetriesPerRequest: null,
  };
}
