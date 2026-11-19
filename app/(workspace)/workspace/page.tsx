import { desc, eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { OverviewPanel } from '@/components/workspace/OverviewPanel';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import {
  auditLogs,
  departments,
  operatorAvailability,
  roles,
  storageQuotas,
  users,
} from '@/src/db/schema.ts';
import {
  getDepartmentTicketQueueSummary,
  type DepartmentTicketQueueSummaryResult,
} from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  if (session.user.mustChangePassword) redirect('/change-password');

  const canViewAudit = hasPermission(session.access, 'admin:audit:view');
  const canViewStorage = hasPermission(session.access, 'admin:storage:manage');

  let dbOk = false;
  let counts = { users: 0, roles: 0, departments: 0 };
  let isAvailable = true;
  let departmentTicketSummary: DepartmentTicketQueueSummaryResult = {
    authorized:
      session.access.isSuperAdmin ||
      hasPermission(session.access, 'desk:workspace:access') ||
      hasPermission(session.access, 'desk:tickets:view_department') ||
      hasPermission(session.access, 'desk:tickets:view_all'),
    scope:
      session.access.isSuperAdmin ||
      hasPermission(session.access, 'desk:tickets:view_all')
        ? 'all_departments'
        : 'assigned_membership',
    totals: {
      openCount: 0,
      awaitingReplyCount: 0,
      waitingForOperatorCount: 0,
      waitingForCustomerCount: 0,
    },
    departments: [],
  };

  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
    const [[uCount], [rCount], [dCount], availRow, deptSummary] =
      await Promise.all([
        db.select({ c: sql<number>`count(*)::int` }).from(users),
        db.select({ c: sql<number>`count(*)::int` }).from(roles),
        db.select({ c: sql<number>`count(*)::int` }).from(departments),
        db.query.operatorAvailability.findFirst({
          where: eq(operatorAvailability.userId, session.user.id),
        }),
        getDepartmentTicketQueueSummary(session.access),
      ]);
    counts = {
      users: uCount?.c ?? 0,
      roles: rCount?.c ?? 0,
      departments: dCount?.c ?? 0,
    };
    isAvailable = availRow?.isAvailable ?? true;
    departmentTicketSummary = deptSummary;
  } catch {
    dbOk = false;
  }

  const storageHealth = canViewStorage
    ? await getStorageDriver().healthCheck()
    : null;

  const quotas = canViewStorage ? await db.select().from(storageQuotas) : [];

  const auditRows = canViewAudit
    ? await db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          actorType: auditLogs.actorType,
          targetType: auditLogs.targetType,
          ipAddress: auditLogs.ipAddress,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(12)
    : [];

  return (
    <OverviewPanel
      user={{
        id: session.user.id,
        username: session.user.username,
        name: session.user.name,
        email: session.user.email,
        authMethod: session.authMethod,
        isAvailable,
        roles: session.access.roles,
        permissions: session.access.permissions,
        departments: session.access.departments.map((d) => ({
          departmentId: d.departmentId,
          slug: d.slug,
          nameFa: d.nameFa,
          isManager: d.isManager,
        })),
      }}
      foundation={{
        databaseOk: dbOk,
        counts,
        storage: storageHealth
          ? {
              ok: storageHealth.ok,
              driver: storageHealth.driver,
              writable: storageHealth.writable,
            }
          : null,
        quotas: quotas.map((q) => ({
          id: q.id,
          scopeType: q.scopeType,
          driver: q.driver,
          maxBytes: q.maxBytes,
          usedBytes: q.usedBytes,
        })),
      }}
      recentAudit={auditRows.map((r) => ({
        id: r.id,
        action: r.action,
        actorType: r.actorType,
        targetType: r.targetType,
        ipAddress: r.ipAddress,
        createdAt: r.createdAt.toISOString(),
      }))}
      departmentTicketSummary={departmentTicketSummary}
    />
  );
}
