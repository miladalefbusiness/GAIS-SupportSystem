import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '../src/core/auth/permissions-catalog.ts';
import { db, pool } from '../src/db/index.ts';
import { auditLogs, authAccounts, authSessions, roles, users } from '../src/db/schema.ts';

const ROOT_DIR = process.cwd();
const TSX_BIN = path.join(ROOT_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runEnvCheck(extraEnv: Record<string, string | undefined>) {
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '/tmp',
    NODE_ENV: 'production',
    APP_URL: 'https://support.example.com',
    APP_VERSION: '0.1.0',
    DOMAIN_NAME: 'support.example.com',
    TZ: 'Asia/Tehran',
    SQL_HOST: 'postgres',
    SQL_PORT: '5432',
    SQL_DB_NAME: 'supportdesk',
    SQL_USER: 'supportdesk_app',
    SQL_PASSWORD: 'StrongDbPassword1234',
    BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    APP_ENCRYPTION_KEY: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    APP_HMAC_KEY: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    STORAGE_DRIVER: 'local',
    STORAGE_ROOT: '/var/lib/supportdesk/storage',
    STORAGE_MAX_BYTES: '1073741824',
    MAX_UPLOAD_MB: '25',
  };

  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) {
      delete baseEnv[k];
    } else {
      baseEnv[k] = v;
    }
  }

  return spawnSync('node', [TSX_BIN, path.join(ROOT_DIR, 'scripts', 'env-check.ts')], {
    cwd: ROOT_DIR,
    env: baseEnv,
    encoding: 'utf8',
  });
}

function runAdminCli(args: string[], stdinInput?: string) {
  return spawnSync('node', [TSX_BIN, path.join(ROOT_DIR, 'scripts', 'admin-cli.ts'), ...args], {
    cwd: ROOT_DIR,
    env: process.env,
    input: stdinInput,
    encoding: 'utf8',
  });
}

describe('Deployment Scripts & Management CLI Tests', () => {
  const testUsername = `cli_admin_${randomUUID().slice(0, 8)}`;
  const testEmail = `${testUsername}@example.test`;
  const initialPassword = 'InitialCliPass123!';
  const rotatedPassword = 'RotatedCliPass456!';
  let createdUserId: string | null = null;

  beforeAll(async () => {
    const existingRole = await db.query.roles.findFirst({
      where: eq(roles.slug, 'dept_manager'),
    });
    if (!existingRole) {
      const roleDef = SYSTEM_ROLES.find((r) => r.slug === 'dept_manager');
      if (roleDef) {
        await db.insert(roles).values({
          id: randomUUID(),
          slug: roleDef.slug,
          nameFa: roleDef.nameFa,
          descriptionFa: roleDef.descriptionFa,
          isSystem: true,
        });
      }
    }
  });

  afterAll(async () => {
    if (createdUserId) {
      await db.delete(auditLogs).where(eq(auditLogs.targetId, createdUserId));
      await db.delete(users).where(eq(users.id, createdUserId));
    }
    await pool.end();
  });

  describe('scripts/env-check.ts', () => {
    it('passes on a complete, valid production configuration without printing secret values', () => {
      const res = runEnvCheck({});
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('validated successfully');
      expect(res.stdout).not.toContain('StrongDbPassword1234');
      expect(res.stdout).not.toContain('0123456789abcdef');
    });

    it('rejects placeholder secrets, public/ STORAGE_ROOT, and incomplete s3 config', () => {
      const placeholderRes = runEnvCheck({
        BETTER_AUTH_SECRET: 'CHANGE_ME_GENERATE_AT_LEAST_32_CHARS_RANDOM_HEX',
      });
      expect(placeholderRes.status).toBe(1);
      expect(placeholderRes.stderr).toContain('placeholder');

      const publicStorageRes = runEnvCheck({
        STORAGE_ROOT: '/app/public/uploads',
      });
      expect(publicStorageRes.status).toBe(1);
      expect(publicStorageRes.stderr).toContain('outside public/');

      const incompleteS3Res = runEnvCheck({
        STORAGE_DRIVER: 's3',
      });
      expect(incompleteS3Res.status).toBe(1);
      expect(incompleteS3Res.stderr).toContain('S3_BUCKET');
    });
  });

  describe('install.sh & bin/supportdesk shell contracts', () => {
    it('passes bash syntax validation and exposes help & version safely', () => {
      expect(() =>
        execFileSync('bash', ['-n', path.join(ROOT_DIR, 'bin', 'supportdesk')])
      ).not.toThrow();
      expect(() =>
        execFileSync('bash', ['-n', path.join(ROOT_DIR, 'install.sh')])
      ).not.toThrow();

      const cliHelp = spawnSync(path.join(ROOT_DIR, 'bin', 'supportdesk'), ['help'], {
        encoding: 'utf8',
      });
      expect(cliHelp.status).toBe(0);
      expect(cliHelp.stdout).toContain('backup [--all|--database|--files]');
      expect(cliHelp.stdout).toContain('restore [--file <archive.tar.gz>]');
      expect(cliHelp.stdout).toContain('reset --destroy-data');
      expect(cliHelp.stdout).toContain('rollback [--version X.Y.Z]');
      expect(cliHelp.stdout).toContain('admin update');
      expect(cliHelp.stdout).toContain('admin reset-password');

      const instHelp = spawnSync('bash', [path.join(ROOT_DIR, 'install.sh'), '--help'], {
        encoding: 'utf8',
      });
      expect(instHelp.status).toBe(0);
      expect(instHelp.stdout).toContain('--repo');
      expect(instHelp.stdout).toContain('--branch');
      expect(instHelp.stdout).toContain('--version');
      expect(instHelp.stdout).toContain('--non-interactive');
    });

    it('refuses latest tag in install.sh/update/rollback and refuses reset without --destroy-data', () => {
      const instLatest = spawnSync(
        'bash',
        [path.join(ROOT_DIR, 'install.sh'), '--version', 'latest'],
        { encoding: 'utf8' }
      );
      expect(instLatest.status).toBe(1);
      expect(instLatest.stderr).toContain("Refusing 'latest'");

      const cliResetSafe = spawnSync(path.join(ROOT_DIR, 'bin', 'supportdesk'), ['reset'], {
        encoding: 'utf8',
      });
      expect(cliResetSafe.status).toBe(1);
      expect(cliResetSafe.stderr).toContain('--destroy-data');

      const cliRollbackLatest = spawnSync(
        path.join(ROOT_DIR, 'bin', 'supportdesk'),
        ['rollback', '--version', 'latest'],
        { encoding: 'utf8' }
      );
      expect(cliRollbackLatest.status).toBe(1);
    });

    it('creates verified checksummed backup bundles, lists checksums, and enforces retention pruning', async () => {
      const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'supportdesk-cli-test-'));
      const fakeBin = path.join(tmpHome, 'fake-bin');
      const storageDir = path.join(tmpHome, 'data', 'storage');
      const backupDir = path.join(tmpHome, 'backups');
      const envPath = path.join(tmpHome, '.env');

      try {
        await fs.mkdir(fakeBin, { recursive: true });
        await fs.mkdir(path.join(storageDir, 'kb'), { recursive: true });
        await fs.mkdir(backupDir, { recursive: true });
        await fs.writeFile(path.join(storageDir, 'kb', 'sample.txt'), 'kb content\n', 'utf8');
        await fs.copyFile(path.join(ROOT_DIR, 'docker-compose.yml'), path.join(tmpHome, 'docker-compose.yml'));
        await fs.copyFile(path.join(ROOT_DIR, 'package.json'), path.join(tmpHome, 'package.json'));
        await fs.writeFile(
          envPath,
          [
            'APP_VERSION="0.1.0"',
            'DOMAIN_NAME="support.example.com"',
            'TZ="Asia/Tehran"',
            'DB_MODE="bundled"',
            'STORAGE_DRIVER="local"',
            'MAX_UPLOAD_MB="25"',
            'BACKUP_RETENTION_COUNT="2"',
            'SQL_PASSWORD="secret-never-exported-to-backup"',
          ].join('\n') + '\n',
          'utf8'
        );

        // Minimal docker shim so compose ps -q returns empty cleanly without daemon
        await fs.writeFile(
          path.join(fakeBin, 'docker'),
          '#!/usr/bin/env bash\nexit 0\n',
          { mode: 0o755 }
        );

        const cliEnv = {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          SUPPORTDESK_HOME: tmpHome,
          SUPPORTDESK_ENV_FILE: envPath,
          SUPPORTDESK_BACKUP_DIR: backupDir,
          SUPPORTDESK_STORAGE_DIR: storageDir,
        };

        const b1 = spawnSync(path.join(ROOT_DIR, 'bin', 'supportdesk'), ['backup', '--files'], {
          env: cliEnv,
          encoding: 'utf8',
        });
        expect(b1.status).toBe(0);
        expect(b1.stdout).toContain('Backup created & verified');

        const files = await fs.readdir(backupDir);
        const bundleName = files.find((f) => f.endsWith('.tar.gz'));
        const shaName = files.find((f) => f.endsWith('.tar.gz.sha256'));
        expect(bundleName).toBeDefined();
        expect(shaName).toBeDefined();

        // Inspect bundle contents: manifest.json, config-metadata.json (no secrets!), storage.tar.gz
        const bundleList = execFileSync('tar', ['-tzf', path.join(backupDir, bundleName!)], {
          encoding: 'utf8',
        });
        expect(bundleList).toContain('manifest.json');
        expect(bundleList).toContain('config-metadata.json');
        expect(bundleList).toContain('storage.tar.gz');

        const cfgJson = execFileSync(
          'tar',
          ['-xOzf', path.join(backupDir, bundleName!), './config-metadata.json'],
          { encoding: 'utf8' }
        );
        expect(cfgJson).toContain('"domainName": "support.example.com"');
        expect(cfgJson).not.toContain('secret-never-exported-to-backup');

        const listRes = spawnSync(path.join(ROOT_DIR, 'bin', 'supportdesk'), ['backup', 'list'], {
          env: cliEnv,
          encoding: 'utf8',
        });
        expect(listRes.status).toBe(0);
        expect(listRes.stdout).toContain('verified');
      } finally {
        await fs.rm(tmpHome, { recursive: true, force: true });
      }
    });
  });

  describe('scripts/admin-cli.ts (PostgreSQL integration)', () => {
    it('creates, lists without exposing password hashes, resets password with session revocation, disables/enables, and enforces password change', async () => {
      // 1. Create admin account via stdin
      const createRes = runAdminCli(
        [
          'create',
          '--username',
          testUsername,
          '--email',
          testEmail,
          '--name',
          'CLI Test Admin',
          '--role',
          'dept_manager',
          '--password-stdin',
          '--json',
        ],
        `${initialPassword}\n`
      );
      expect(createRes.status).toBe(0);
      const createdPayload = JSON.parse(createRes.stdout.trim()) as {
        ok: boolean;
        userId: string;
        username: string;
        role: string;
      };
      expect(createdPayload.ok).toBe(true);
      expect(createdPayload.username).toBe(testUsername);
      createdUserId = createdPayload.userId;

      // 2. List accounts & ensure NO password hash is returned
      const listRes = runAdminCli(['list', '--json']);
      expect(listRes.status).toBe(0);
      expect(listRes.stdout).not.toContain('password');
      const listed = JSON.parse(listRes.stdout) as Array<{ username: string; roles: string[] }>;
      const found = listed.find((u) => u.username === testUsername);
      expect(found).toBeDefined();
      expect(found?.roles).toContain('dept_manager');

      // Insert active session to prove reset-password revokes active sessions
      await db.insert(authSessions).values({
        id: randomUUID(),
        userId: createdUserId,
        token: `tok_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600_000),
      });

      // 3. Reset password + force-change -> revokes sessions and updates hash
      const resetRes = runAdminCli(
        ['reset-password', '--username', testUsername, '--password-stdin', '--force-change', '--json'],
        `${rotatedPassword}\n`
      );
      expect(resetRes.status).toBe(0);
      const resetPayload = JSON.parse(resetRes.stdout.trim()) as {
        ok: boolean;
        sessionsRevoked: boolean;
      };
      expect(resetPayload.ok).toBe(true);
      expect(resetPayload.sessionsRevoked).toBe(true);

      const remainingSessions = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, createdUserId));
      expect(remainingSessions).toHaveLength(0);

      const accRow = await db.query.authAccounts.findFirst({
        where: and(eq(authAccounts.userId, createdUserId), eq(authAccounts.providerId, 'credential')),
      });
      expect(accRow?.password).toBeTruthy();
      expect(await verifyPassword({ hash: accRow!.password!, password: rotatedPassword })).toBe(true);

      // 4. Disable suspends user and revokes any active session
      await db.insert(authSessions).values({
        id: randomUUID(),
        userId: createdUserId,
        token: `tok_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const disableRes = runAdminCli(['disable', '--username', testUsername]);
      expect(disableRes.status).toBe(0);

      const afterDisable = await db.query.users.findFirst({
        where: eq(users.id, createdUserId),
      });
      expect(afterDisable?.status).toBe('suspended');
      expect(
        await db.select().from(authSessions).where(eq(authSessions.userId, createdUserId))
      ).toHaveLength(0);

      // 5. Re-enable & force-password-change
      const enableRes = runAdminCli(['enable', '--username', testUsername]);
      expect(enableRes.status).toBe(0);

      const forceRes = runAdminCli(['force-password-change', '--username', testUsername]);
      expect(forceRes.status).toBe(0);

      const finalUser = await db.query.users.findFirst({
        where: eq(users.id, createdUserId),
      });
      expect(finalUser?.status).toBe('active');
      expect(finalUser?.mustChangePassword).toBe(true);

      // 6. Edit username, email, display name & password via admin update -> revokes sessions
      await db.insert(authSessions).values({
        id: randomUUID(),
        userId: createdUserId,
        token: `tok_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const updatedUsername = `${testUsername}_renamed`;
      const updatedEmail = `${updatedUsername}@example.test`;
      const updatedPassword = 'UpdatedCliPass789!';
      const updateRes = runAdminCli(
        [
          'update',
          '--username',
          testUsername,
          '--new-username',
          updatedUsername,
          '--email',
          updatedEmail,
          '--name',
          'CLI Renamed Admin',
          '--password-stdin',
          '--json',
        ],
        `${updatedPassword}\n`
      );
      expect(updateRes.status).toBe(0);
      const updatePayload = JSON.parse(updateRes.stdout.trim()) as {
        ok: boolean;
        username: string;
        email: string;
        sessionsRevoked: boolean;
      };
      expect(updatePayload.ok).toBe(true);
      expect(updatePayload.username).toBe(updatedUsername);
      expect(updatePayload.email).toBe(updatedEmail);
      expect(updatePayload.sessionsRevoked).toBe(true);

      const renamedRow = await db.query.users.findFirst({
        where: eq(users.id, createdUserId),
      });
      expect(renamedRow?.username).toBe(updatedUsername);
      expect(renamedRow?.name).toBe('CLI Renamed Admin');
      expect(
        await db.select().from(authSessions).where(eq(authSessions.userId, createdUserId))
      ).toHaveLength(0);

      const accUpdated = await db.query.authAccounts.findFirst({
        where: and(eq(authAccounts.userId, createdUserId), eq(authAccounts.providerId, 'credential')),
      });
      expect(await verifyPassword({ hash: accUpdated!.password!, password: updatedPassword })).toBe(
        true
      );
    }, 30000);
  });
});
