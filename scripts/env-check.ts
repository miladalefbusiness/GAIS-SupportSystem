import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const PLACEHOLDER_MARKERS = ['CHANGE_ME', 'MY_GEMINI_API_KEY', 'your-org'];

function isPlaceholder(val: string | undefined): boolean {
  if (!val) return true;
  return PLACEHOLDER_MARKERS.some((marker) => val.includes(marker));
}

const strictProdSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  APP_URL: z.string().url('APP_URL must be a valid http(s) URL'),
  APP_VERSION: z.string().min(1, 'APP_VERSION is required'),
  DOMAIN_NAME: z.string().min(1).optional(),
  TZ: z.string().min(1).default('Asia/Tehran'),
  SQL_HOST: z.string().min(1, 'SQL_HOST is required'),
  SQL_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  SQL_DB_NAME: z.string().min(1, 'SQL_DB_NAME is required'),
  SQL_USER: z.string().min(1, 'SQL_USER is required'),
  SQL_PASSWORD: z.string().min(12, 'SQL_PASSWORD must be at least 12 characters'),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  APP_ENCRYPTION_KEY: z
    .string()
    .min(32, 'APP_ENCRYPTION_KEY must be at least 32 characters (64 hex chars recommended)'),
  APP_HMAC_KEY: z
    .string()
    .min(32, 'APP_HMAC_KEY must be at least 32 characters (64 hex chars recommended)'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_ROOT: z.string().min(1, 'STORAGE_ROOT is required'),
  STORAGE_MAX_BYTES: z.coerce.number().int().positive(),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(250).default(25),
});

function main() {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = strictProdSchema.safeParse(process.env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
  }

  const isProd = process.env.NODE_ENV === 'production';

  const secretKeys = [
    'SQL_PASSWORD',
    'SQL_ADMIN_PASSWORD',
    'POSTGRES_PASSWORD',
    'BETTER_AUTH_SECRET',
    'APP_ENCRYPTION_KEY',
    'APP_HMAC_KEY',
  ];

  for (const key of secretKeys) {
    const val = process.env[key];
    if (val && isPlaceholder(val)) {
      errors.push(`${key} still contains a placeholder value`);
    }
  }

  if (isProd && process.env.OTP_PROVIDER === 'dev_mock') {
    warnings.push('OTP_PROVIDER is set to dev_mock (note: dev_mock is blocked in production runtime).');
  }

  if (process.env.STORAGE_DRIVER === 's3') {
    for (const s3Key of ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      if (!process.env[s3Key]?.trim()) {
        errors.push(`${s3Key} is required when STORAGE_DRIVER=s3`);
      }
    }
  }

  if (process.env.SMTP_HOST?.trim()) {
    if (!process.env.SMTP_FROM?.trim()) {
      warnings.push('SMTP_HOST is set without SMTP_FROM.');
    }
  }

  const storageRoot = process.env.STORAGE_ROOT || './data/storage';
  if (path.normalize(storageRoot).includes(`${path.sep}public`)) {
    errors.push('STORAGE_ROOT must point outside public/ web directory.');
  }

  if (errors.length > 0) {
    console.error('[env-check] Configuration validation FAILED:');
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  for (const w of warnings) {
    console.warn(`[env-check] WARN: ${w}`);
  }

  console.log('[env-check] Environment configuration validated successfully.');
}

main();
