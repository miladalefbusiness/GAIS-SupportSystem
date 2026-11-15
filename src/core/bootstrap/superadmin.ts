import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  auditLogs,
  authAccounts,
  permissions,
  rolePermissions,
  roles,
  storageQuotas,
  systemSettings,
  userRoles,
  users,
} from '../../db/schema.ts';
import { getEnv } from '../config/env.ts';
import { logger } from '../logging/logger.ts';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../auth/permissions-catalog.ts';

export interface BootstrapReport {
  rbacSeeded: boolean;
  superAdminCreated: boolean;
  skippedReason?: string;
}

const BOOTSTRAP_LOCK_ID = 90421001;

export async function runInitialBootstrap(): Promise<BootstrapReport> {
  const env = getEnv();

  return db.transaction(async (tx) => {
    // Serialize concurrent bootstrap attempts across containers/requests
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_ID})`);

    // 1. Seed canonical permissions and system roles idempotently (never overwrite existing custom edits)
    for (const perm of PERMISSION_CATALOG) {
      await tx
        .insert(permissions)
        .values({
          id: perm.id,
          key: perm.key,
          module: perm.module,
          nameFa: perm.nameFa,
          descriptionFa: perm.descriptionFa,
        })
        .onConflictDoNothing({ target: permissions.key });
    }

    const dbPerms = await tx.select().from(permissions);
    const permIdByKey = new Map(dbPerms.map((p) => [p.key, p.id]));

    for (const role of SYSTEM_ROLES) {
      await tx
        .insert(roles)
        .values({
          id: role.id,
          slug: role.slug,
          nameFa: role.nameFa,
          descriptionFa: role.descriptionFa,
          isSystem: role.isSystem,
        })
        .onConflictDoNothing({ target: roles.slug });

      const existingRole = await tx.query.roles.findFirst({
        where: eq(roles.slug, role.slug),
      });
      if (!existingRole) continue;

      for (const permKey of role.permissionKeys) {
        const permId = permIdByKey.get(permKey);
        if (!permId) continue;
        await tx
          .insert(rolePermissions)
          .values({
            roleId: existingRole.id,
            permissionId: permId,
          })
          .onConflictDoNothing();
      }
    }

    // 2. Ensure global storage quota row exists idempotently
    await tx
      .insert(storageQuotas)
      .values({
        id: 'quota_global_default',
        scopeType: 'global',
        scopeId: 'global',
        driver: env.STORAGE_DRIVER,
        maxBytes: env.STORAGE_MAX_BYTES,
        usedBytes: 0,
      })
      .onConflictDoNothing({ target: storageQuotas.id });

    // 3. Check if a Super Admin already exists OR bootstrap was previously completed
    const superAdminRole = await tx.query.roles.findFirst({
      where: eq(roles.slug, 'super_admin'),
    });

    if (!superAdminRole) {
      throw new Error('Failed to resolve super_admin role during bootstrap.');
    }

    const existingSuperAdmins = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, superAdminRole.id))
      .limit(1);

    const bootstrapSetting = await tx.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'bootstrap_completed'),
    });

    if (existingSuperAdmins.length > 0 || bootstrapSetting) {
      return {
        rbacSeeded: true,
        superAdminCreated: false,
        skippedReason: 'Super Admin already initialized; existing accounts preserved.',
      };
    }

    const username = env.SUPERADMIN_USERNAME?.trim().toLowerCase();
    const password = env.SUPERADMIN_PASSWORD;
    const email =
      env.SUPERADMIN_EMAIL?.trim().toLowerCase() ||
      (username ? `${username}@support.local` : undefined);

    if (!username || !password || !email) {
      logger.warn('bootstrap.superadmin_env_missing', {
        hasUsername: Boolean(username),
        hasPassword: Boolean(password),
      });
      return {
        rbacSeeded: true,
        superAdminCreated: false,
        skippedReason:
          'SUPERADMIN_USERNAME or SUPERADMIN_PASSWORD not set; skipping initial admin creation.',
      };
    }

    const userId = randomUUID();
    const passwordHash = await hashPassword(password);

    await tx.insert(users).values({
      id: userId,
      username,
      displayUsername: username,
      email,
      emailVerified: true,
      name: env.SUPERADMIN_NAME,
      status: 'active',
      mustChangePassword: true,
      isBootstrapAdmin: true,
    });

    await tx.insert(authAccounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
    });

    await tx.insert(userRoles).values({
      userId,
      roleId: superAdminRole.id,
    });

    await tx.insert(systemSettings).values({
      key: 'bootstrap_completed',
      valueJson: {
        completedAt: new Date().toISOString(),
        initialAdminUserId: userId,
        version: env.APP_VERSION,
      },
      isSensitive: false,
    });

    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: userId,
      actorType: 'system',
      action: 'system.bootstrap.superadmin',
      targetType: 'user',
      targetId: userId,
      metadataJson: {
        username,
        mustChangePassword: true,
      },
    });

    logger.info('bootstrap.superadmin_created', { userId, username });

    return {
      rbacSeeded: true,
      superAdminCreated: true,
    };
  });
}
