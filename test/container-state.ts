import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';

declare global {
  var __e2eContainers:
    | {
        postgres: StartedPostgreSqlContainer;
        redis: StartedRedisContainer;
      }
    | undefined;
}

export {};
