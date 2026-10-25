import { z } from 'zod';
import ms, { type StringValue } from 'ms';

const durationSchema = z.string().refine((value) => {
  const duration = ms(value as StringValue);
  return (
    duration !== undefined && Number.isFinite(duration) && duration >= 1000
  );
}, 'Expiration must be a valid duration of at least one second');

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must use the postgresql:// or postgres:// protocol',
    ),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: durationSchema.default('15m'),
  JWT_REFRESH_EXPIRES_IN: durationSchema.default('7d'),
  REDIS_URL: z
    .string()
    .url()
    .refine(
      (value) => ['redis:', 'rediss:'].includes(new URL(value).protocol),
      'REDIS_URL must use redis:// or rediss://',
    )
    .optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z.enum(['true', 'false']).optional(),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().max(65535).default(6379),
  WEBHOOK_SECRET: z
    .string()
    .min(16, 'WEBHOOK_SECRET must be at least 16 characters'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    console.error('Invalid environment variables:');
    console.error(JSON.stringify(errors, null, 2));
    throw new Error('Invalid environment configuration; see errors above');
  }

  return result.data;
}
