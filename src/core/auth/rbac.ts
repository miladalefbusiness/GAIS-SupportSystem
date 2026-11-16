import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  departmentMemberships,
  departments,
  permissions,
  rolePermissions,
  roles,
  userPermissionOverrides,
  userRoles,
} from '../../db/schema.ts';
import { resolveEffectivePermissions } from './permissions-catalog.ts';

export interface DepartmentMembershipSummary {
  departmentId: string;
  slug: string;
  nameFa: string;
  isActive: boolean;
  isManager: boolean;
  isAvailable: boolean;
  maxActiveTickets: number;
}

export interface UserAccessProfile {
  userId?: string;
  roles: Array<{ id: string; slug: string; nameFa: string }>;
  permissions: string[];
  departments: DepartmentMembershipSummary[];
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

  const membershipRows = await db
    .select({
      departmentId: departments.id,
      slug: departments.slug,
      nameFa: departments.nameFa,
      isActive: departments.isActive,
      isManager: departmentMemberships.isManager,
      isAvailable: departmentMemberships.isAvailable,
      maxActiveTickets: departmentMemberships.maxActiveTickets,
    })
    .from(departmentMemberships)
    .innerJoin(departments, eq(departmentMemberships.departmentId, departments.id))
    .where(eq(departmentMemberships.userId, userId));

  const isSuperAdmin = assignedRoles.some((r) => r.slug === 'super_admin');
  const normalizedOverrides = overrideRows.filter(
    (o): o is { permissionKey: string; effect: 'allow' | 'deny' } =>
      o.effect === 'allow' || o.effect === 'deny'
  );

  const effectivePermissions = resolveEffectivePermissions(
    rolePermRows.map((p) => p.key),
    normalizedOverrides
  );

  return {
    userId,
    roles: assignedRoles,
    permissions: effectivePermissions,
    departments: membershipRows,
    isSuperAdmin,
  };
}

export function hasPermission(profile: UserAccessProfile, permissionKey: string): boolean {
  return profile.permissions.includes(permissionKey);
}

export function canAccessDepartment(
  profile: UserAccessProfile,
  departmentId: string
): boolean {
  if (profile.isSuperAdmin || hasPermission(profile, 'desk:tickets:view_all')) {
    return true;
  }
  return profile.departments.some((d) => d.departmentId === departmentId);
}

export function canManageDepartment(
  profile: UserAccessProfile,
  departmentId: string
): boolean {
  if (profile.isSuperAdmin || hasPermission(profile, 'admin:departments:manage')) {
    return true;
  }
  return profile.departments.some(
    (d) => d.departmentId === departmentId && d.isManager
  );
}
