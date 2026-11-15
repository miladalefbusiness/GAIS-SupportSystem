import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().optional().or(z.literal('')),
  APP_VERSION: z.string().min(1).default('0.1.0'),
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  APP_ENCRYPTION_KEY: z.string().optional(),
  APP_HMAC_KEY: z.string().optional(),
  SUPERADMIN_USERNAME: z.string().min(3).optional(),
  SUPERADMIN_EMAIL: z.string().email().optional(),
  SUPERADMIN_PASSWORD: z.string().min(8).optional(),
  SUPERADMIN_NAME: z.string().min(1).default('مدیر ارشد سامانه'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_ROOT: z.string().default('./data/storage'),
  STORAGE_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024 * 1024),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(): AppEnv {
  return envSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    APP_URL: process.env.APP_URL,
    APP_VERSION: process.env.APP_VERSION,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
    APP_HMAC_KEY: process.env.APP_HMAC_KEY,
    SUPERADMIN_USERNAME: process.env.SUPERADMIN_USERNAME,
    SUPERADMIN_EMAIL: process.env.SUPERADMIN_EMAIL,
    SUPERADMIN_PASSWORD: process.env.SUPERADMIN_PASSWORD,
    SUPERADMIN_NAME: process.env.SUPERADMIN_NAME,
    STORAGE_DRIVER: process.env.STORAGE_DRIVER,
    STORAGE_ROOT: process.env.STORAGE_ROOT,
    STORAGE_MAX_BYTES: process.env.STORAGE_MAX_BYTES,
  });
}

export function resolveStorageRoot(): string {
  const raw = process.env.STORAGE_ROOT || './data/storage';
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export function getAuthSecret(): string {
  const envSecret = process.env.BETTER_AUTH_SECRET;
  if (envSecret && envSecret.length >= 32) {
    return envSecret;
  }
  if (process.env.NODE_ENV === 'production') {
    // Allow fallback ONLY when running inside managed Cloud Run without explicit BETTER_AUTH_SECRET
    // while still warning operators in logs to configure a dedicated secret.
    if (process.env.K_SERVICE && process.env.SQL_PASSWORD) {
      return `cr-${process.env.SQL_PASSWORD}-${process.env.APPLET_ID || 'supportdesk'}`;
    }
    throw new Error('BETTER_AUTH_SECRET must be configured with at least 32 characters in production.');
  }
  return 'dev-only-ephemeral-secret-change-in-production-32chars';
}
