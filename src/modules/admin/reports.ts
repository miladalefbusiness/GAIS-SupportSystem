import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import {
  aiUsageLogs,
  departmentMemberships,
  departments,
  operatorAvailability,
  storedFiles,
  ticketAssignments,
  ticketMessages,
  tickets,
  users,
} from '@/src/db/schema.ts';

export type ReportWindowDays = number | 'all';

export function parseReportWindowDays(
  raw: unknown,
  fallback: ReportWindowDays = 30
): ReportWindowDays {
  if (raw === 'all') return 'all';
  const parsed =
    typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 365) {
    return parsed;
  }
  return fallback;
}

export interface OperationalReportsFilter {
  days?: ReportWindowDays;
  departmentId?: string;
}

function resolveCutoffDate(days: ReportWindowDays): Date | null {
  if (days === 'all') return null;
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - days);
  return now;
}

function roundHours(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Number(num.toFixed(1));
}

export async function getOperationalReports(filters: OperationalReportsFilter = {}) {
  const days: ReportWindowDays = parseReportWindowDays(filters.days, 30);
  const now = new Date();
  const cutoff = resolveCutoffDate(days);
  const deptId = filters.departmentId?.trim() || null;

  const ticketWhereParts = [];
  if (cutoff) ticketWhereParts.push(gte(tickets.createdAt, cutoff));
  if (deptId) ticketWhereParts.push(eq(tickets.departmentId, deptId));
  const ticketWhere =
    ticketWhereParts.length > 0 ? and(...ticketWhereParts) : undefined;

  const assignmentWhereParts = [];
  if (cutoff) assignmentWhereParts.push(gte(ticketAssignments.createdAt, cutoff));
  if (deptId) assignmentWhereParts.push(eq(ticketAssignments.toDepartmentId, deptId));
  const assignmentWhere =
    assignmentWhereParts.length > 0 ? and(...assignmentWhereParts) : undefined;

  const aiWhereParts = [];
  if (cutoff) aiWhereParts.push(gte(aiUsageLogs.createdAt, cutoff));
  if (deptId) aiWhereParts.push(eq(aiUsageLogs.departmentId, deptId));
  const aiWhere = aiWhereParts.length > 0 ? and(...aiWhereParts) : undefined;

  const [
    allDepts,
    statusRows,
    priorityRows,
    deptTicketRows,
    recentTicketRows,
    dailyCreatedRows,
    dailyResolvedRows,
    overallResolveRow,
    assignmentStrategyRows,
    recentAssignmentRows,
    operatorBaseRows,
    opActiveTicketsRows,
    opResolvedTicketsRows,
    opRepliesRows,
    opNotesRows,
    opFilesRows,
    aiStatusRows,
    aiDeptRows,
  ] = await Promise.all([
    db
      .select({
        id: departments.id,
        nameFa: departments.nameFa,
        slug: departments.slug,
        isActive: departments.isActive,
        assignmentStrategy: departments.assignmentStrategy,
      })
      .from(departments)
      .orderBy(asc(departments.displayOrder), asc(departments.nameFa)),
    db
      .select({
        status: tickets.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(tickets)
      .where(ticketWhere)
      .groupBy(tickets.status),
    db
      .select({
        priority: tickets.priority,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(tickets)
      .where(ticketWhere)
      .groupBy(tickets.priority),
    db
      .select({
        departmentId: tickets.departmentId,
        total: sql<number>`COUNT(*)::int`,
        openCount: sql<number>`COUNT(*) FILTER (WHERE ${tickets.status} NOT IN ('resolved', 'closed'))::int`,
        resolvedCount: sql<number>`COUNT(*) FILTER (WHERE ${tickets.status} IN ('resolved', 'closed'))::int`,
        avgResolveHours: sql<number | null>`AVG(EXTRACT(EPOCH FROM (COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) - ${tickets.createdAt})) / 3600.0) FILTER (WHERE COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) IS NOT NULL)`,
      })
      .from(tickets)
      .where(ticketWhere)
      .groupBy(tickets.departmentId),
    db
      .select({
        id: tickets.id,
        referenceCode: tickets.referenceCode,
        subject: tickets.subject,
        status: tickets.status,
        priority: tickets.priority,
        departmentId: tickets.departmentId,
        assignedOperatorId: tickets.assignedOperatorId,
        createdAt: tickets.createdAt,
        lastMessageAt: tickets.lastMessageAt,
      })
      .from(tickets)
      .where(ticketWhere)
      .orderBy(desc(tickets.createdAt))
      .limit(25),
    db
      .select({
        dayIso: sql<string>`to_char(DATE_TRUNC('day', ${tickets.createdAt} AT TIME ZONE 'Asia/Tehran'), 'YYYY-MM-DD')`,
        createdCount: sql<number>`COUNT(*)::int`,
        openCount: sql<number>`COUNT(*) FILTER (WHERE ${tickets.status} NOT IN ('resolved', 'closed'))::int`,
      })
      .from(tickets)
      .where(ticketWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1 ASC`),
    db
      .select({
        dayIso: sql<string>`to_char(DATE_TRUNC('day', COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) AT TIME ZONE 'Asia/Tehran'), 'YYYY-MM-DD')`,
        resolvedCount: sql<number>`COUNT(*)::int`,
      })
      .from(tickets)
      .where(
        and(
          inArray(tickets.status, ['resolved', 'closed']),
          sql`COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) IS NOT NULL`,
          ...(cutoff
            ? [sql`COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) >= ${cutoff}`]
            : []),
          ...(deptId ? [eq(tickets.departmentId, deptId)] : [])
        )
      )
      .groupBy(sql`1`)
      .orderBy(sql`1 ASC`),
    db
      .select({
        avgResolveHours: sql<number | null>`AVG(EXTRACT(EPOCH FROM (COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) - ${tickets.createdAt})) / 3600.0) FILTER (WHERE COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) IS NOT NULL)`,
      })
      .from(tickets)
      .where(
        and(
          inArray(tickets.status, ['resolved', 'closed']),
          ...(cutoff ? [gte(tickets.createdAt, cutoff)] : []),
          ...(deptId ? [eq(tickets.departmentId, deptId)] : [])
        )
      ),
    db
      .select({
        strategyUsed: ticketAssignments.strategyUsed,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(ticketAssignments)
      .where(assignmentWhere)
      .groupBy(ticketAssignments.strategyUsed),
    db
      .select({
        id: ticketAssignments.id,
        ticketId: ticketAssignments.ticketId,
        referenceCode: tickets.referenceCode,
        toDepartmentId: ticketAssignments.toDepartmentId,
        toOperatorId: ticketAssignments.toOperatorId,
        fromOperatorId: ticketAssignments.fromOperatorId,
        assignedByUserId: ticketAssignments.assignedByUserId,
        strategyUsed: ticketAssignments.strategyUsed,
        reason: ticketAssignments.reason,
        createdAt: ticketAssignments.createdAt,
      })
      .from(ticketAssignments)
      .innerJoin(tickets, eq(ticketAssignments.ticketId, tickets.id))
      .where(assignmentWhere)
      .orderBy(desc(ticketAssignments.createdAt))
      .limit(30),
    db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
        isAvailable: operatorAvailability.isAvailable,
      })
      .from(users)
      .leftJoin(operatorAvailability, eq(users.id, operatorAvailability.userId))
      .orderBy(asc(users.name)),
    db
      .select({
        userId: tickets.assignedOperatorId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(tickets)
      .where(
        and(
          sql`${tickets.assignedOperatorId} IS NOT NULL`,
          sql`${tickets.status} NOT IN ('resolved', 'closed')`,
          ...(deptId ? [eq(tickets.departmentId, deptId)] : [])
        )
      )
      .groupBy(tickets.assignedOperatorId),
    db
      .select({
        userId: tickets.assignedOperatorId,
        count: sql<number>`COUNT(*)::int`,
        avgResolveHours: sql<number | null>`AVG(EXTRACT(EPOCH FROM (COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) - ${tickets.createdAt})) / 3600.0) FILTER (WHERE COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) IS NOT NULL)`,
        minResolveHours: sql<number | null>`MIN(EXTRACT(EPOCH FROM (COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) - ${tickets.createdAt})) / 3600.0) FILTER (WHERE COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) IS NOT NULL)`,
        maxResolveHours: sql<number | null>`MAX(EXTRACT(EPOCH FROM (COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) - ${tickets.createdAt})) / 3600.0) FILTER (WHERE COALESCE(${tickets.resolvedAt}, ${tickets.closedAt}) IS NOT NULL)`,
      })
      .from(tickets)
      .where(
        and(
          sql`${tickets.assignedOperatorId} IS NOT NULL`,
          inArray(tickets.status, ['resolved', 'closed']),
          ...(cutoff ? [gte(tickets.createdAt, cutoff)] : []),
          ...(deptId ? [eq(tickets.departmentId, deptId)] : [])
        )
      )
      .groupBy(tickets.assignedOperatorId),
    db
      .select({
        userId: ticketMessages.senderUserId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(ticketMessages)
      .where(
        and(
          eq(ticketMessages.senderType, 'operator'),
          eq(ticketMessages.visibility, 'public'),
          ...(cutoff ? [gte(ticketMessages.createdAt, cutoff)] : [])
        )
      )
      .groupBy(ticketMessages.senderUserId),
    db
      .select({
        userId: ticketMessages.senderUserId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(ticketMessages)
      .where(
        and(
          eq(ticketMessages.senderType, 'operator'),
          eq(ticketMessages.visibility, 'internal_note'),
          ...(cutoff ? [gte(ticketMessages.createdAt, cutoff)] : [])
        )
      )
      .groupBy(ticketMessages.senderUserId),
    db
      .select({
        userId: storedFiles.uploadedByUserId,
        fileCount: sql<number>`COUNT(*)::int`,
        bytes: sql<number>`COALESCE(SUM(${storedFiles.byteSize}), 0)::bigint`,
      })
      .from(storedFiles)
      .where(
        and(
          ...(cutoff ? [gte(storedFiles.createdAt, cutoff)] : []),
          ...(deptId ? [eq(storedFiles.departmentId, deptId)] : [])
        )
      )
      .groupBy(storedFiles.uploadedByUserId),
    db
      .select({
        status: aiUsageLogs.status,
        count: sql<number>`COUNT(*)::int`,
        avgLatencyMs: sql<number>`COALESCE(AVG(${aiUsageLogs.latencyMs}), 0)::int`,
        promptTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.promptTokens}), 0)::int`,
        completionTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.completionTokens}), 0)::int`,
      })
      .from(aiUsageLogs)
      .where(aiWhere)
      .groupBy(aiUsageLogs.status),
    db
      .select({
        departmentId: aiUsageLogs.departmentId,
        total: sql<number>`COUNT(*)::int`,
        successCount: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.status} = 'success')::int`,
        abstainedCount: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.status} = 'abstained')::int`,
        escalatedCount: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.status} = 'escalated')::int`,
        errorCount: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.status} = 'provider_error')::int`,
        avgLatencyMs: sql<number>`COALESCE(AVG(${aiUsageLogs.latencyMs}), 0)::int`,
      })
      .from(aiUsageLogs)
      .where(aiWhere)
      .groupBy(aiUsageLogs.departmentId),
  ]);

  const memberships = await db
    .select({
      userId: departmentMemberships.userId,
      departmentId: departmentMemberships.departmentId,
      maxActiveTickets: departmentMemberships.maxActiveTickets,
      isManager: departmentMemberships.isManager,
    })
    .from(departmentMemberships);

  const deptNameById = new Map(allDepts.map((d) => [d.id, d.nameFa]));
  const userById = new Map(operatorBaseRows.map((u) => [u.id, u]));

  const totalTickets = statusRows.reduce((acc, r) => acc + r.count, 0);
  const openTickets = statusRows
    .filter((r) => r.status !== 'resolved' && r.status !== 'closed')
    .reduce((acc, r) => acc + r.count, 0);
  const resolvedTickets = statusRows
    .filter((r) => r.status === 'resolved' || r.status === 'closed')
    .reduce((acc, r) => acc + r.count, 0);

  const deptMap = new Map(deptTicketRows.map((r) => [r.departmentId, r]));
  const departmentBreakdown = allDepts
    .filter((d) => !deptId || d.id === deptId)
    .map((d) => {
      const stats = deptMap.get(d.id);
      return {
        departmentId: d.id,
        nameFa: d.nameFa,
        assignmentStrategy: d.assignmentStrategy,
        total: stats?.total ?? 0,
        openCount: stats?.openCount ?? 0,
        resolvedCount: stats?.resolvedCount ?? 0,
        avgResolveHours:
          stats?.avgResolveHours !== null && stats?.avgResolveHours !== undefined
            ? Number(Number(stats.avgResolveHours).toFixed(1))
            : null,
      };
    });

  const activeMap = new Map(opActiveTicketsRows.map((r) => [r.userId || '', r.count]));
  const resolvedMap = new Map(
    opResolvedTicketsRows.map((r) => [r.userId || '', r])
  );
  const repliesMap = new Map(opRepliesRows.map((r) => [r.userId || '', r.count]));
  const notesMap = new Map(opNotesRows.map((r) => [r.userId || '', r.count]));
  const filesMap = new Map(opFilesRows.map((r) => [r.userId || '', r]));

  const createdByDay = new Map(dailyCreatedRows.map((r) => [r.dayIso, r]));
  const resolvedByDay = new Map(dailyResolvedRows.map((r) => [r.dayIso, r.resolvedCount]));
  const dayKeysSet = new Set<string>([
    ...dailyCreatedRows.map((r) => r.dayIso),
    ...dailyResolvedRows.map((r) => r.dayIso),
  ]);

  if (typeof days === 'number' && days <= 90) {
    const tehranFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - offset);
      dayKeysSet.add(tehranFormatter.format(d));
    }
  }

  const dailyVolume = Array.from(dayKeysSet)
    .sort((a, b) => a.localeCompare(b))
    .map((dateIso) => {
      const c = createdByDay.get(dateIso);
      return {
        dateIso,
        createdCount: c?.createdCount ?? 0,
        openCount: c?.openCount ?? 0,
        resolvedCount: resolvedByDay.get(dateIso) ?? 0,
      };
    });

  const operatorActivity = operatorBaseRows
    .filter((op) => {
      if (!deptId) return true;
      return memberships.some((m) => m.userId === op.id && m.departmentId === deptId);
    })
    .map((op) => {
      const opMemberships = memberships.filter((m) => m.userId === op.id);
      const fileStat = filesMap.get(op.id);
      const resolvedStat = resolvedMap.get(op.id);
      return {
        userId: op.id,
        name: op.name,
        username: op.username,
        status: op.status,
        isAvailable: op.isAvailable ?? true,
        departmentNames: opMemberships
          .map((m) => deptNameById.get(m.departmentId))
          .filter((n): n is string => Boolean(n)),
        activeTickets: activeMap.get(op.id) ?? 0,
        resolvedTickets: resolvedStat?.count ?? 0,
        avgResolveHours: roundHours(resolvedStat?.avgResolveHours),
        minResolveHours: roundHours(resolvedStat?.minResolveHours),
        maxResolveHours: roundHours(resolvedStat?.maxResolveHours),
        publicReplies: repliesMap.get(op.id) ?? 0,
        internalNotes: notesMap.get(op.id) ?? 0,
        filesUploaded: fileStat?.fileCount ?? 0,
        bytesUploaded: Number(fileStat?.bytes ?? 0),
        lastLoginAt: op.lastLoginAt ? op.lastLoginAt.toISOString() : null,
      };
    });

  const totalAiCalls = aiStatusRows.reduce((acc, r) => acc + r.count, 0);
  const aiSuccess = aiStatusRows.find((r) => r.status === 'success')?.count ?? 0;
  const aiAbstained = aiStatusRows.find((r) => r.status === 'abstained')?.count ?? 0;
  const aiEscalated = aiStatusRows.find((r) => r.status === 'escalated')?.count ?? 0;
  const aiErrors = aiStatusRows.find((r) => r.status === 'provider_error')?.count ?? 0;
  const aiPromptTokens = aiStatusRows.reduce((acc, r) => acc + r.promptTokens, 0);
  const aiCompletionTokens = aiStatusRows.reduce(
    (acc, r) => acc + r.completionTokens,
    0
  );

  return {
    filters: {
      days,
      departmentId: deptId,
      windowStartIso: cutoff ? cutoff.toISOString() : null,
      windowEndIso: now.toISOString(),
    },
    departments: allDepts.map((d) => ({ id: d.id, nameFa: d.nameFa })),
    ticketSummary: {
      total: totalTickets,
      open: openTickets,
      resolved: resolvedTickets,
      avgResolveHours: roundHours(overallResolveRow[0]?.avgResolveHours),
      dailyVolume,
      byStatus: statusRows,
      byPriority: priorityRows,
      byDepartment: departmentBreakdown,
      recentTickets: recentTicketRows.map((t) => ({
        id: t.id,
        referenceCode: t.referenceCode,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        departmentName: deptNameById.get(t.departmentId) || t.departmentId,
        assignedOperatorName: t.assignedOperatorId
          ? userById.get(t.assignedOperatorId)?.name || '—'
          : 'در صف انتظار',
        createdAt: t.createdAt.toISOString(),
        lastMessageAt: t.lastMessageAt.toISOString(),
      })),
    },
    assignmentReport: {
      totalAssignments: assignmentStrategyRows.reduce((acc, r) => acc + r.count, 0),
      byStrategy: assignmentStrategyRows,
      recentAssignments: recentAssignmentRows.map((a) => ({
        id: a.id,
        ticketId: a.ticketId,
        referenceCode: a.referenceCode,
        toDepartmentName: deptNameById.get(a.toDepartmentId) || a.toDepartmentId,
        toOperatorName: a.toOperatorId
          ? userById.get(a.toOperatorId)?.name || a.toOperatorId
          : 'صف دپارتمان',
        fromOperatorName: a.fromOperatorId
          ? userById.get(a.fromOperatorId)?.name || a.fromOperatorId
          : null,
        assignedByName: a.assignedByUserId
          ? userById.get(a.assignedByUserId)?.name || 'سیستم'
          : 'موتور توزیع خودکار',
        strategyUsed: a.strategyUsed,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
    },
    operatorActivity,
    aiSummary: {
      totalCalls: totalAiCalls,
      successCount: aiSuccess,
      abstainedCount: aiAbstained,
      escalatedCount: aiEscalated,
      errorCount: aiErrors,
      promptTokens: aiPromptTokens,
      completionTokens: aiCompletionTokens,
      byDepartment: aiDeptRows.map((r) => ({
        departmentId: r.departmentId,
        departmentName: r.departmentId
          ? deptNameById.get(r.departmentId) || r.departmentId
          : 'عمومی',
        total: r.total,
        successCount: r.successCount,
        abstainedCount: r.abstainedCount,
        escalatedCount: r.escalatedCount,
        errorCount: r.errorCount,
        avgLatencyMs: r.avgLatencyMs,
      })),
    },
  };
}

export function sanitizeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Mitigate CSV formula injection (=, +, -, @, tab, CR)
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const escaped = neutralized.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function rowsToUtf8Csv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [
    headers.map(sanitizeCsvCell).join(','),
    ...rows.map((r) => r.map(sanitizeCsvCell).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}
