import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext, recordAuditLog } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { listAuditLogsAdmin } from '@/src/modules/admin/audit.ts';
import {
  getOperationalReports,
  parseReportWindowDays,
  rowsToUtf8Csv,
} from '@/src/modules/admin/reports.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireAnyPermission([
    'admin:panel:access',
    'admin:audit:view',
    'desk:tickets:view_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = req.nextUrl;
    const kind = searchParams.get('kind') || 'tickets';
    const days = parseReportWindowDays(searchParams.get('days'), 30);
    const departmentId = searchParams.get('departmentId') || undefined;
    const { ipAddress, userAgent } = extractRequestContext(req.headers);

    if (kind === 'audit') {
      if (!hasPermission(guard.session.access, 'admin:audit:view')) {
        return NextResponse.json(
          { error: 'برای خروجی گزارش ممیزی مجوز admin:audit:view الزامی است.' },
          { status: 403 }
        );
      }
      const auditData = await listAuditLogsAdmin({
        q: searchParams.get('q') || undefined,
        action: searchParams.get('action') || undefined,
        actorType: searchParams.get('actorType') || undefined,
        targetType: searchParams.get('targetType') || undefined,
        page: 1,
        pageSize: 100,
      });

      const csv = rowsToUtf8Csv(
        ['ID', 'Action', 'ActorType', 'ActorUsername', 'TargetType', 'TargetId', 'IP', 'CreatedAt'],
        auditData.items.map((row) => [
          row.id,
          row.action,
          row.actorType,
          row.actorUsername || '',
          row.targetType || '',
          row.targetId || '',
          row.ipAddress || '',
          row.createdAt,
        ])
      );

      await recordAuditLog({
        actorUserId: guard.session.user.id,
        action: 'admin.reports.exported',
        targetType: 'audit_logs',
        ipAddress,
        userAgent,
        metadata: { kind: 'audit', rowCount: auditData.items.length },
      });

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="audit-logs-export.csv"',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const reports = await getOperationalReports({ days, departmentId });
    let csv = '';
    let filename = 'report.csv';

    if (kind === 'assignments') {
      filename = 'assignments-report.csv';
      csv = rowsToUtf8Csv(
        [
          'ReferenceCode',
          'Department',
          'Strategy',
          'ToOperator',
          'FromOperator',
          'AssignedBy',
          'Reason',
          'CreatedAt',
        ],
        reports.assignmentReport.recentAssignments.map((a) => [
          a.referenceCode,
          a.toDepartmentName,
          a.strategyUsed,
          a.toOperatorName,
          a.fromOperatorName || '',
          a.assignedByName,
          a.reason || '',
          a.createdAt,
        ])
      );
    } else if (kind === 'operators') {
      filename = 'operators-activity-report.csv';
      csv = rowsToUtf8Csv(
        [
          'Name',
          'Username',
          'Status',
          'Available',
          'Departments',
          'ActiveTickets',
          'ResolvedTickets',
          'AvgResolveHours',
          'MinResolveHours',
          'MaxResolveHours',
          'PublicReplies',
          'InternalNotes',
          'FilesUploaded',
          'BytesUploaded',
        ],
        reports.operatorActivity.map((op) => [
          op.name,
          op.username,
          op.status,
          op.isAvailable ? 'yes' : 'no',
          op.departmentNames.join(' | '),
          op.activeTickets,
          op.resolvedTickets,
          op.avgResolveHours ?? '',
          op.minResolveHours ?? '',
          op.maxResolveHours ?? '',
          op.publicReplies,
          op.internalNotes,
          op.filesUploaded,
          op.bytesUploaded,
        ])
      );
    } else {
      filename = 'tickets-report.csv';
      csv = rowsToUtf8Csv(
        [
          'ReferenceCode',
          'Subject',
          'Department',
          'Status',
          'Priority',
          'AssignedOperator',
          'CreatedAt',
          'LastMessageAt',
        ],
        reports.ticketSummary.recentTickets.map((t) => [
          t.referenceCode,
          t.subject,
          t.departmentName,
          t.status,
          t.priority,
          t.assignedOperatorName,
          t.createdAt,
          t.lastMessageAt,
        ])
      );
    }

    await recordAuditLog({
      actorUserId: guard.session.user.id,
      action: 'admin.reports.exported',
      targetType: 'operational_report',
      ipAddress,
      userAgent,
      metadata: { kind, days, departmentId: departmentId || null },
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    logger.error('admin.reports.export_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در تهیه خروجی CSV گزارش.' },
      { status: 500 }
    );
  }
}
