import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { auditLogs, users } from '@/src/db/schema.ts';

export interface AuditLogFilterParams {
  q?: string;
  action?: string;
  actorType?: string;
  targetType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function listAuditLogsAdmin(params: AuditLogFilterParams = {}) {
  const page = Math.max(1, Math.floor(params.page || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(params.pageSize || 25)));
  const offset = (page - 1) * pageSize;

  const whereParts = [];

  if (params.action?.trim()) {
    whereParts.push(ilike(auditLogs.action, `${params.action.trim()}%`));
  }
  if (
    params.actorType === 'user' ||
    params.actorType === 'system' ||
    params.actorType === 'anonymous'
  ) {
    whereParts.push(eq(auditLogs.actorType, params.actorType));
  }
  if (params.targetType?.trim()) {
    whereParts.push(eq(auditLogs.targetType, params.targetType.trim()));
  }
  if (params.from?.trim()) {
    const d = new Date(params.from);
    if (!Number.isNaN(d.getTime())) {
      whereParts.push(gte(auditLogs.createdAt, d));
    }
  }
  if (params.to?.trim()) {
    const d = new Date(params.to);
    if (!Number.isNaN(d.getTime())) {
      whereParts.push(lte(auditLogs.createdAt, d));
    }
  }
  if (params.q?.trim()) {
    const pattern = `%${params.q.trim()}%`;
    whereParts.push(
      or(
        ilike(auditLogs.action, pattern),
        ilike(auditLogs.targetId, pattern),
        ilike(auditLogs.ipAddress, pattern),
        ilike(users.username, pattern),
        ilike(users.name, pattern)
      )
    );
  }

  const whereClause = whereParts.length > 0 ? and(...whereParts) : undefined;

  const [[countRow], items, distinctTargetTypes] = await Promise.all([
    db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(whereClause),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorType: auditLogs.actorType,
        actorUserId: auditLogs.actorUserId,
        actorName: users.name,
        actorUsername: users.username,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        metadataJson: auditLogs.metadataJson,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .selectDistinct({ targetType: auditLogs.targetType })
      .from(auditLogs)
      .where(sql`${auditLogs.targetType} IS NOT NULL`),
  ]);

  const total = countRow?.total ?? 0;

  return {
    items: items.map((row) => ({
      id: row.id,
      action: row.action,
      actorType: row.actorType,
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      actorUsername: row.actorUsername,
      targetType: row.targetType,
      targetId: row.targetId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      metadata: row.metadataJson ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    targetTypes: distinctTargetTypes
      .map((r) => r.targetType)
      .filter((t): t is string => Boolean(t))
      .sort(),
  };
}
