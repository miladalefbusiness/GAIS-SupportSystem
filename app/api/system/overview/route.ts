import { desc, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/src/core/auth/guards.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import { auditLogs, roles, storageQuotas, users } from '@/src/db/schema.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  const { session } = authResult;
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

  const recentAudit = canViewAudit
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

  return NextResponse.json({
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
      phase: 7,
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
      quotas,
    },
    recentAudit,
  });
}
