import type {} from './container-state.js';

export default async function teardown(): Promise<void> {
  const containers = globalThis.__e2eContainers;
  if (!containers) return;
  const results = await Promise.allSettled([
    containers.postgres.stop(),
    containers.redis.stop(),
  ]);
  globalThis.__e2eContainers = undefined;
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      'Testcontainer teardown failed',
    );
}
