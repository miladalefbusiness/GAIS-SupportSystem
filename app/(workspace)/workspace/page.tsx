import { desc, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { WorkspaceShell, type WorkspaceOverviewData } from '@/components/workspace/WorkspaceShell';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import { auditLogs, roles, storageQuotas, users } from '@/src/db/schema.ts';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const session = await getCurrentSession();
  if (!session) {
    redirect('/login');
  }
  if (session.user.mustChangePassword) {
    redirect('/auth/change-password');
  }

  const canViewAudit = hasPermission(session.access, 'admin:audit:view');
  const canViewStorage = hasPermission(session.access, 'admin:storage:manage');

  let dbOk = false;
  let counts = { users: 0, roles: 0 };
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
    const [uCount] = await db.select({ c: sql<number>`count(*)::int` }).from(users);
    const [rCount] = await db.select({ c: sql<number>`count(*)::int` }).from(roles);
    counts = { users: uCount?.c ?? 0, roles: rCount?.c ?? 0 };
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

  const data: WorkspaceOverviewData = {
    user: {
      id: session.user.id,
      username: session.user.username,
      name: session.user.name,
      email: session.user.email,
      authMethod: session.authMethod,
      roles: session.access.roles,
      permissions: session.access.permissions,
    },
    foundation: {
      phase: 1,
      version: process.env.APP_VERSION || '0.1.0',
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
    },
    recentAudit: auditRows.map((r) => ({
      id: r.id,
      action: r.action,
      actorType: r.actorType,
      targetType: r.targetType,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    })),
  };

  return <WorkspaceShell data={data} />;
}
