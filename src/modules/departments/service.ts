import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import type { UserAccessProfile } from '@/src/core/auth/rbac.ts';
import { db } from '@/src/db/index.ts';
import {
  departmentMemberships,
  departments,
  operatorAvailability,
  users,
} from '@/src/db/schema.ts';

export interface PublicDepartmentCard {
  id: string;
  slug: string;
  nameFa: string;
  descriptionFa: string;
  iconKey: string;
  displayOrder: number;
  aiEnabled: boolean;
  humanOperatorsAvailable: boolean;
  welcomeMessageFa: string;
}

export async function listPublicDepartments(): Promise<PublicDepartmentCard[]> {
  return db
    .select({
      id: departments.id,
      slug: departments.slug,
      nameFa: departments.nameFa,
      descriptionFa: departments.descriptionFa,
      iconKey: departments.iconKey,
      displayOrder: departments.displayOrder,
      aiEnabled: departments.aiEnabled,
      humanOperatorsAvailable: departments.humanOperatorsAvailable,
      welcomeMessageFa: departments.welcomeMessageFa,
    })
    .from(departments)
    .where(and(eq(departments.isActive, true), eq(departments.isPublic, true)))
    .orderBy(asc(departments.displayOrder), asc(departments.createdAt));
}

export async function listAllDepartmentsAdmin() {
  const deptRows = await db
    .select()
    .from(departments)
    .orderBy(asc(departments.displayOrder), asc(departments.createdAt));

  const memberships = await db
    .select({
      id: departmentMemberships.id,
      departmentId: departmentMemberships.departmentId,
      userId: departmentMemberships.userId,
      isManager: departmentMemberships.isManager,
      isAvailable: departmentMemberships.isAvailable,
      maxActiveTickets: departmentMemberships.maxActiveTickets,
      userName: users.name,
      username: users.username,
      userStatus: users.status,
    })
    .from(departmentMemberships)
    .innerJoin(users, eq(departmentMemberships.userId, users.id));

  const membersByDept = new Map<string, typeof memberships>();
  for (const m of memberships) {
    const existing = membersByDept.get(m.departmentId) || [];
    existing.push(m);
    membersByDept.set(m.departmentId, existing);
  }

  return deptRows.map((d) => ({
    ...d,
    members: membersByDept.get(d.id) || [],
  }));
}

export async function createDepartment(params: {
  input: {
    nameFa: string;
    slug: string;
    descriptionFa: string;
    iconKey: string;
    displayOrder: number;
    isActive: boolean;
    isPublic: boolean;
    aiEnabled: boolean;
    humanOperatorsAvailable: boolean;
    assignmentStrategy: string;
    welcomeMessageFa: string;
    maxUploadSizeMb: number;
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const id = `dept_${randomUUID()}`;
  const [created] = await db
    .insert(departments)
    .values({
      id,
      ...params.input,
      createdBy: params.actorUserId,
    })
    .returning();

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'department.created',
    targetType: 'department',
    targetId: created.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      slug: created.slug,
      isActive: created.isActive,
      isPublic: created.isPublic,
    },
  });

  return created;
}

export async function updateDepartment(params: {
  id: string;
  input: Partial<{
    nameFa: string;
    slug: string;
    descriptionFa: string;
    iconKey: string;
    displayOrder: number;
    isActive: boolean;
    isPublic: boolean;
    aiEnabled: boolean;
    humanOperatorsAvailable: boolean;
    assignmentStrategy: string;
    welcomeMessageFa: string;
    maxUploadSizeMb: number;
  }>;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const [updated] = await db
    .update(departments)
    .set({
      ...params.input,
      updatedAt: new Date(),
    })
    .where(eq(departments.id, params.id))
    .returning();

  if (!updated) return null;

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'department.updated',
    targetType: 'department',
    targetId: updated.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      slug: updated.slug,
      isActive: updated.isActive,
      isPublic: updated.isPublic,
    },
  });

  return updated;
}

export async function replaceDepartmentMembers(params: {
  departmentId: string;
  members: Array<{
    userId: string;
    isManager: boolean;
    isAvailable: boolean;
    maxActiveTickets: number;
  }>;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, params.departmentId),
  });
  if (!dept) return null;

  if (params.members.length > 0) {
    const requestedIds = Array.from(new Set(params.members.map((m) => m.userId)));
    const foundUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, requestedIds));
    if (foundUsers.length !== requestedIds.length) {
      throw new Error('INVALID_USER_IDS');
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(departmentMemberships)
      .where(eq(departmentMemberships.departmentId, params.departmentId));

    const seen = new Set<string>();
    for (const member of params.members) {
      if (seen.has(member.userId)) continue;
      seen.add(member.userId);
      await tx.insert(departmentMemberships).values({
        id: `dm_${randomUUID()}`,
        departmentId: params.departmentId,
        userId: member.userId,
        isManager: member.isManager,
        isAvailable: member.isAvailable,
        maxActiveTickets: member.maxActiveTickets,
        assignedBy: params.actorUserId,
      });
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'department.memberships.updated',
    targetType: 'department',
    targetId: params.departmentId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: { memberCount: params.members.length },
  });

  return true;
}

export async function listAuthorizedDepartmentsForOperator(
  access: UserAccessProfile
) {
  const canViewAll =
    access.isSuperAdmin || access.permissions.includes('desk:tickets:view_all');

  if (canViewAll) {
    const rows = await db
      .select({
        id: departments.id,
        slug: departments.slug,
        nameFa: departments.nameFa,
        descriptionFa: departments.descriptionFa,
        iconKey: departments.iconKey,
        isActive: departments.isActive,
        isPublic: departments.isPublic,
        aiEnabled: departments.aiEnabled,
        assignmentStrategy: departments.assignmentStrategy,
      })
      .from(departments)
      .orderBy(asc(departments.displayOrder), asc(departments.createdAt));

    return rows.map((r) => ({
      ...r,
      isManager: true,
      accessScope: 'all_departments' as const,
    }));
  }

  const deptIds = access.departments.map((d) => d.departmentId);
  if (deptIds.length === 0) return [];

  const rows = await db
    .select({
      id: departments.id,
      slug: departments.slug,
      nameFa: departments.nameFa,
      descriptionFa: departments.descriptionFa,
      iconKey: departments.iconKey,
      isActive: departments.isActive,
      isPublic: departments.isPublic,
      aiEnabled: departments.aiEnabled,
      assignmentStrategy: departments.assignmentStrategy,
    })
    .from(departments)
    .where(inArray(departments.id, deptIds))
    .orderBy(asc(departments.displayOrder), asc(departments.createdAt));

  const managerMap = new Map(
    access.departments.map((d) => [d.departmentId, d.isManager])
  );

  return rows.map((r) => ({
    ...r,
    isManager: Boolean(managerMap.get(r.id)),
    accessScope: 'assigned_membership' as const,
  }));
}

export async function getAuthorizedDepartmentDetails(departmentId: string) {
  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, departmentId),
  });
  if (!dept) return null;

  const members = await db
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      userStatus: users.status,
      isManager: departmentMemberships.isManager,
      membershipAvailable: departmentMemberships.isAvailable,
      maxActiveTickets: departmentMemberships.maxActiveTickets,
      globalAvailable: sql<boolean>`coalesce(${operatorAvailability.isAvailable}, true)`,
      availabilityNote: operatorAvailability.availabilityNote,
    })
    .from(departmentMemberships)
    .innerJoin(users, eq(departmentMemberships.userId, users.id))
    .leftJoin(operatorAvailability, eq(users.id, operatorAvailability.userId))
    .where(eq(departmentMemberships.departmentId, departmentId))
    .orderBy(asc(users.name));

  return {
    department: {
      id: dept.id,
      slug: dept.slug,
      nameFa: dept.nameFa,
      descriptionFa: dept.descriptionFa,
      iconKey: dept.iconKey,
      isActive: dept.isActive,
      isPublic: dept.isPublic,
      aiEnabled: dept.aiEnabled,
      humanOperatorsAvailable: dept.humanOperatorsAvailable,
      assignmentStrategy: dept.assignmentStrategy,
      welcomeMessageFa: dept.welcomeMessageFa,
      maxUploadSizeMb: dept.maxUploadSizeMb,
    },
    members,
  };
}
