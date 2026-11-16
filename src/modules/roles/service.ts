import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { db } from '@/src/db/index.ts';
import { permissions, rolePermissions, roles } from '@/src/db/schema.ts';

const PROTECTED_SUPERADMIN_PERMISSIONS = [
  'admin:panel:access',
  'admin:roles:manage',
  'admin:users:manage',
  'admin:departments:manage',
];

export async function listRolesAndPermissionsAdmin() {
  const roleRows = await db
    .select()
    .from(roles)
    .orderBy(asc(roles.createdAt));

  const permRows = await db
    .select()
    .from(permissions)
    .orderBy(asc(permissions.module), asc(permissions.key));

  const rpRows = await db.select().from(rolePermissions);

  return {
    roles: roleRows.map((r) => ({
      ...r,
      permissionIds: rpRows
        .filter((rp) => rp.roleId === r.id)
        .map((rp) => rp.permissionId),
    })),
    permissions: permRows,
  };
}

export async function createCustomRole(params: {
  input: {
    slug: string;
    nameFa: string;
    descriptionFa: string;
    permissionIds: string[];
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  if (params.input.permissionIds.length > 0) {
    const foundPerms = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.id, params.input.permissionIds));
    if (foundPerms.length !== new Set(params.input.permissionIds).size) {
      throw new Error('INVALID_PERMISSION_IDS');
    }
  }

  const roleId = `role_${randomUUID()}`;

  const created = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(roles)
      .values({
        id: roleId,
        slug: params.input.slug,
        nameFa: params.input.nameFa,
        descriptionFa: params.input.descriptionFa,
        isSystem: false,
      })
      .returning();

    for (const permissionId of Array.from(new Set(params.input.permissionIds))) {
      await tx.insert(rolePermissions).values({ roleId, permissionId });
    }
    return inserted;
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'role.created',
    targetType: 'role',
    targetId: created.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      slug: created.slug,
      permissionCount: params.input.permissionIds.length,
    },
  });

  return created;
}

export async function updateRole(params: {
  roleId: string;
  input: {
    nameFa?: string;
    descriptionFa?: string;
    permissionIds?: string[];
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db.query.roles.findFirst({
    where: eq(roles.id, params.roleId),
  });
  if (!existing) return null;

  if (params.input.permissionIds) {
    const uniquePermIds = Array.from(new Set(params.input.permissionIds));
    if (uniquePermIds.length > 0) {
      const foundPerms = await db
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.id, uniquePermIds));
      if (foundPerms.length !== uniquePermIds.length) {
        throw new Error('INVALID_PERMISSION_IDS');
      }

      if (existing.slug === 'super_admin') {
        const keySet = new Set(foundPerms.map((p) => p.key));
        for (const requiredKey of PROTECTED_SUPERADMIN_PERMISSIONS) {
          if (!keySet.has(requiredKey)) {
            throw new Error('CANNOT_STRIP_SUPERADMIN_CORE_PERMS');
          }
        }
      }
    } else if (existing.slug === 'super_admin') {
      throw new Error('CANNOT_STRIP_SUPERADMIN_CORE_PERMS');
    }
  }

  await db.transaction(async (tx) => {
    if (
      params.input.nameFa !== undefined ||
      params.input.descriptionFa !== undefined
    ) {
      await tx
        .update(roles)
        .set({
          ...(params.input.nameFa !== undefined
            ? { nameFa: params.input.nameFa }
            : {}),
          ...(params.input.descriptionFa !== undefined
            ? { descriptionFa: params.input.descriptionFa }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(roles.id, params.roleId));
    }

    if (params.input.permissionIds) {
      await tx
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, params.roleId));
      for (const permissionId of Array.from(new Set(params.input.permissionIds))) {
        await tx
          .insert(rolePermissions)
          .values({ roleId: params.roleId, permissionId });
      }
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'role.updated',
    targetType: 'role',
    targetId: params.roleId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      slug: existing.slug,
      permissionsUpdated: Boolean(params.input.permissionIds),
    },
  });

  return { ok: true };
}
