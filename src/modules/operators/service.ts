import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { db } from '@/src/db/index.ts';
import {
  authAccounts,
  authSessions,
  departmentMemberships,
  departments,
  operatorAvailability,
  permissions,
  roles,
  userPermissionOverrides,
  userRoles,
  users,
} from '@/src/db/schema.ts';

export async function listOperatorsAdmin() {
  const userRows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      name: users.name,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      isBootstrapAdmin: users.isBootstrapAdmin,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      isAvailable: operatorAvailability.isAvailable,
      availabilityNote: operatorAvailability.availabilityNote,
    })
    .from(users)
    .leftJoin(operatorAvailability, eq(users.id, operatorAvailability.userId))
    .orderBy(asc(users.createdAt));

  const roleRows = await db
    .select({
      userId: userRoles.userId,
      roleId: roles.id,
      slug: roles.slug,
      nameFa: roles.nameFa,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id));

  const membershipRows = await db
    .select({
      userId: departmentMemberships.userId,
      departmentId: departments.id,
      nameFa: departments.nameFa,
      slug: departments.slug,
      isManager: departmentMemberships.isManager,
      isAvailable: departmentMemberships.isAvailable,
      maxActiveTickets: departmentMemberships.maxActiveTickets,
    })
    .from(departmentMemberships)
    .innerJoin(departments, eq(departmentMemberships.departmentId, departments.id));

  const overrideRows = await db
    .select({
      userId: userPermissionOverrides.userId,
      permissionId: permissions.id,
      permissionKey: permissions.key,
      permissionNameFa: permissions.nameFa,
      effect: userPermissionOverrides.effect,
      reason: userPermissionOverrides.reason,
    })
    .from(userPermissionOverrides)
    .innerJoin(permissions, eq(userPermissionOverrides.permissionId, permissions.id));

  return userRows.map((u) => ({
    ...u,
    isAvailable: u.isAvailable ?? true,
    roles: roleRows.filter((r) => r.userId === u.id),
    departments: membershipRows.filter((m) => m.userId === u.id),
    overrides: overrideRows.filter((o) => o.userId === u.id),
  }));
}

export async function createOperator(params: {
  input: {
    username: string;
    email: string;
    name: string;
    password: string;
    mustChangePassword: boolean;
    isAvailable: boolean;
    roleIds: string[];
    departments: Array<{
      departmentId: string;
      isManager: boolean;
      maxActiveTickets: number;
    }>;
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const { input } = params;

  const foundRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.id, input.roleIds));
  if (foundRoles.length !== new Set(input.roleIds).size) {
    throw new Error('INVALID_ROLE_IDS');
  }

  if (input.departments.length > 0) {
    const deptIds = Array.from(new Set(input.departments.map((d) => d.departmentId)));
    const foundDepts = await db
      .select({ id: departments.id })
      .from(departments)
      .where(inArray(departments.id, deptIds));
    if (foundDepts.length !== deptIds.length) {
      throw new Error('INVALID_DEPARTMENT_IDS');
    }
  }

  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      username: input.username,
      displayUsername: input.username,
      email: input.email,
      emailVerified: true,
      name: input.name,
      status: 'active',
      mustChangePassword: input.mustChangePassword,
      isBootstrapAdmin: false,
    });

    await tx.insert(authAccounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
    });

    await tx.insert(operatorAvailability).values({
      userId,
      isAvailable: input.isAvailable,
    });

    for (const roleId of Array.from(new Set(input.roleIds))) {
      await tx.insert(userRoles).values({
        userId,
        roleId,
        assignedBy: params.actorUserId,
      });
    }

    const seenDepts = new Set<string>();
    for (const dept of input.departments) {
      if (seenDepts.has(dept.departmentId)) continue;
      seenDepts.add(dept.departmentId);
      await tx.insert(departmentMemberships).values({
        id: `dm_${randomUUID()}`,
        departmentId: dept.departmentId,
        userId,
        isManager: dept.isManager,
        isAvailable: input.isAvailable,
        maxActiveTickets: dept.maxActiveTickets,
        assignedBy: params.actorUserId,
      });
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'operator.created',
    targetType: 'user',
    targetId: userId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      username: input.username,
      roleCount: input.roleIds.length,
      departmentCount: input.departments.length,
    },
  });

  return { id: userId, username: input.username, email: input.email, name: input.name };
}

export async function updateOperator(params: {
  targetUserId: string;
  input: {
    name?: string;
    email?: string;
    status?: 'active' | 'inactive' | 'suspended';
    isAvailable?: boolean;
    availabilityNote?: string | null;
    roleIds?: string[];
    departments?: Array<{
      departmentId: string;
      isManager: boolean;
      isAvailable: boolean;
      maxActiveTickets: number;
    }>;
    resetPassword?: string;
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db.query.users.findFirst({
    where: eq(users.id, params.targetUserId),
  });
  if (!existing) return null;

  // Guard against disabling or demoting the last active super_admin
  const superAdminRole = await db.query.roles.findFirst({
    where: eq(roles.slug, 'super_admin'),
  });
  if (superAdminRole) {
    const allSuperAdmins = await db
      .select({ userId: userRoles.userId, status: users.status })
      .from(userRoles)
      .innerJoin(users, eq(userRoles.userId, users.id))
      .where(eq(userRoles.roleId, superAdminRole.id));

    const targetIsSuperAdmin = allSuperAdmins.some(
      (sa) => sa.userId === params.targetUserId
    );
    const otherActiveSuperAdmins = allSuperAdmins.filter(
      (sa) => sa.userId !== params.targetUserId && sa.status === 'active'
    );

    if (targetIsSuperAdmin && otherActiveSuperAdmins.length === 0) {
      if (params.input.status && params.input.status !== 'active') {
        throw new Error('CANNOT_DISABLE_LAST_SUPERADMIN');
      }
      if (
        params.input.roleIds &&
        !params.input.roleIds.includes(superAdminRole.id)
      ) {
        throw new Error('CANNOT_REMOVE_LAST_SUPERADMIN_ROLE');
      }
    }
  }

  if (params.input.roleIds) {
    const foundRoles = await db
      .select({ id: roles.id })
      .from(roles)
      .where(inArray(roles.id, params.input.roleIds));
    if (foundRoles.length !== new Set(params.input.roleIds).size) {
      throw new Error('INVALID_ROLE_IDS');
    }
  }

  if (params.input.departments && params.input.departments.length > 0) {
    const deptIds = Array.from(
      new Set(params.input.departments.map((d) => d.departmentId))
    );
    const foundDepts = await db
      .select({ id: departments.id })
      .from(departments)
      .where(inArray(departments.id, deptIds));
    if (foundDepts.length !== deptIds.length) {
      throw new Error('INVALID_DEPARTMENT_IDS');
    }
  }

  const newPasswordHash = params.input.resetPassword
    ? await hashPassword(params.input.resetPassword)
    : null;

  await db.transaction(async (tx) => {
    const userUpdates: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (params.input.name !== undefined) userUpdates.name = params.input.name;
    if (params.input.email !== undefined) userUpdates.email = params.input.email;
    if (params.input.status !== undefined) userUpdates.status = params.input.status;
    if (newPasswordHash) userUpdates.mustChangePassword = true;

    await tx
      .update(users)
      .set(userUpdates)
      .where(eq(users.id, params.targetUserId));

    if (
      params.input.isAvailable !== undefined ||
      params.input.availabilityNote !== undefined
    ) {
      const existingAvail = await tx.query.operatorAvailability.findFirst({
        where: eq(operatorAvailability.userId, params.targetUserId),
      });
      await tx
        .insert(operatorAvailability)
        .values({
          userId: params.targetUserId,
          isAvailable:
            params.input.isAvailable ?? existingAvail?.isAvailable ?? true,
          availabilityNote:
            params.input.availabilityNote !== undefined
              ? params.input.availabilityNote
              : existingAvail?.availabilityNote ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: operatorAvailability.userId,
          set: {
            ...(params.input.isAvailable !== undefined
              ? { isAvailable: params.input.isAvailable }
              : {}),
            ...(params.input.availabilityNote !== undefined
              ? { availabilityNote: params.input.availabilityNote }
              : {}),
            updatedAt: new Date(),
          },
        });
    }

    if (params.input.roleIds) {
      await tx
        .delete(userRoles)
        .where(eq(userRoles.userId, params.targetUserId));
      for (const roleId of Array.from(new Set(params.input.roleIds))) {
        await tx.insert(userRoles).values({
          userId: params.targetUserId,
          roleId,
          assignedBy: params.actorUserId,
        });
      }
    }

    if (params.input.departments) {
      await tx
        .delete(departmentMemberships)
        .where(eq(departmentMemberships.userId, params.targetUserId));
      const seenDepts = new Set<string>();
      for (const dept of params.input.departments) {
        if (seenDepts.has(dept.departmentId)) continue;
        seenDepts.add(dept.departmentId);
        await tx.insert(departmentMemberships).values({
          id: `dm_${randomUUID()}`,
          departmentId: dept.departmentId,
          userId: params.targetUserId,
          isManager: dept.isManager,
          isAvailable: dept.isAvailable,
          maxActiveTickets: dept.maxActiveTickets,
          assignedBy: params.actorUserId,
        });
      }
    }

    if (newPasswordHash) {
      const credAccount = await tx.query.authAccounts.findFirst({
        where: and(
          eq(authAccounts.userId, params.targetUserId),
          eq(authAccounts.providerId, 'credential')
        ),
      });
      if (credAccount) {
        await tx
          .update(authAccounts)
          .set({ password: newPasswordHash, updatedAt: new Date() })
          .where(eq(authAccounts.id, credAccount.id));
      } else {
        await tx.insert(authAccounts).values({
          id: randomUUID(),
          accountId: params.targetUserId,
          providerId: 'credential',
          userId: params.targetUserId,
          password: newPasswordHash,
        });
      }
    }

    // Revoke active sessions if suspended, deactivated, or password reset
    if (
      (params.input.status && params.input.status !== 'active') ||
      newPasswordHash
    ) {
      await tx
        .delete(authSessions)
        .where(eq(authSessions.userId, params.targetUserId));
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: newPasswordHash ? 'operator.password_reset' : 'operator.updated',
    targetType: 'user',
    targetId: params.targetUserId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      statusChangedTo: params.input.status,
      rolesUpdated: Boolean(params.input.roleIds),
      departmentsUpdated: Boolean(params.input.departments),
    },
  });

  return { ok: true };
}

export async function replaceOperatorPermissionOverrides(params: {
  targetUserId: string;
  overrides: Array<{
    permissionId: string;
    effect: 'allow' | 'deny';
    reason?: string;
  }>;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db.query.users.findFirst({
    where: eq(users.id, params.targetUserId),
  });
  if (!existing) return null;

  if (params.overrides.length > 0) {
    const permIds = Array.from(new Set(params.overrides.map((o) => o.permissionId)));
    const foundPerms = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.id, permIds));
    if (foundPerms.length !== permIds.length) {
      throw new Error('INVALID_PERMISSION_IDS');
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, params.targetUserId));

    const seen = new Set<string>();
    for (const o of params.overrides) {
      if (seen.has(o.permissionId)) continue;
      seen.add(o.permissionId);
      await tx.insert(userPermissionOverrides).values({
        userId: params.targetUserId,
        permissionId: o.permissionId,
        effect: o.effect,
        reason: o.reason ?? null,
        grantedBy: params.actorUserId,
      });
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'operator.permissions_overridden',
    targetType: 'user',
    targetId: params.targetUserId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: { overrideCount: params.overrides.length },
  });

  return true;
}
