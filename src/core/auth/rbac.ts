import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  permissions,
  rolePermissions,
  roles,
  userPermissionOverrides,
  userRoles,
} from '../../db/schema.ts';
import { resolveEffectivePermissions } from './permissions-catalog.ts';

export interface UserAccessProfile {
  roles: Array<{ id: string; slug: string; nameFa: string }>;
  permissions: string[];
  isSuperAdmin: boolean;
}

export async function getUserAccessProfile(userId: string): Promise<UserAccessProfile> {
  const assignedRoles = await db
    .select({
      id: roles.id,
      slug: roles.slug,
      nameFa: roles.nameFa,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const rolePermRows = await db
    .select({
      key: permissions.key,
    })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(userRoles.userId, userId));

  const overrideRows = await db
    .select({
      permissionKey: permissions.key,
      effect: userPermissionOverrides.effect,
    })
    .from(userPermissionOverrides)
    .innerJoin(permissions, eq(userPermissionOverrides.permissionId, permissions.id))
    .where(eq(userPermissionOverrides.userId, userId));

  const isSuperAdmin = assignedRoles.some((r) => r.slug === 'super_admin');
  const normalizedOverrides = overrideRows
    .filter((o): o is { permissionKey: string; effect: 'allow' | 'deny' } =>
      o.effect === 'allow' || o.effect === 'deny'
    );

  const effectivePermissions = resolveEffectivePermissions(
    rolePermRows.map((p) => p.key),
    normalizedOverrides
  );

  return {
    roles: assignedRoles,
    permissions: effectivePermissions,
    isSuperAdmin,
  };
}

export function hasPermission(profile: UserAccessProfile, permissionKey: string): boolean {
  return profile.permissions.includes(permissionKey);
}
