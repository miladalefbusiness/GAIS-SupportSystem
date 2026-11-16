import 'dotenv/config';
import { eq, like, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.ts';
import {
  aiUsageLogs,
  auditLogs,
  customerProfiles,
  departmentMemberships,
  departments,
  storedFiles,
  systemSettings,
  ticketAssignments,
  ticketMessages,
  tickets,
  users,
} from '../src/db/schema.ts';
import { listAuditLogsAdmin } from '../src/modules/admin/audit.ts';
import { getSystemHealthDiagnostics } from '../src/modules/admin/health.ts';
import {
  getOperationalReports,
  rowsToUtf8Csv,
  sanitizeCsvCell,
} from '../src/modules/admin/reports.ts';
import {
  DEFAULT_PLATFORM_SETTINGS,
  getPlatformSettings,
  PLATFORM_SETTINGS_KEY,
  platformSettingsSchema,
  updatePlatformSettings,
  type PlatformSettingsDto,
} from '../src/modules/admin/settings.ts';

const P6_ADMIN = 'p6test_admin';
const P6_OP = 'p6test_operator';
const P6_DEPT = 'p6test_dept';
const P6_CUSTOMER = 'p6test_customer';
const P6_TICKET_OPEN = 'p6test_ticket_open';
const P6_TICKET_RESOLVED = 'p6test_ticket_resolved';
const P6_AUDIT_1 = 'p6test_audit_1';
const P6_AUDIT_2 = 'p6test_audit_2';

describe('Phase 6: Super Admin Settings, Operational Reports, Audit Viewer & System Health', () => {
  let hadSettingsRow = false;
  let originalSettings: PlatformSettingsDto = DEFAULT_PLATFORM_SETTINGS;

  beforeAll(async () => {
    const existingRow = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, PLATFORM_SETTINGS_KEY),
    });
    if (existingRow) {
      hadSettingsRow = true;
      const loaded = await getPlatformSettings();
      originalSettings = loaded.settings;
    }

    await db
      .insert(users)
      .values([
        {
          id: P6_ADMIN,
          username: 'p6test_admin',
          email: 'p6test_admin@example.local',
          name: 'مدیر ارشد تست فاز ۶',
          status: 'active',
        },
        {
          id: P6_OP,
          username: 'p6test_operator',
          email: 'p6test_operator@example.local',
          name: 'اپراتور تست فاز ۶',
          status: 'active',
          lastLoginAt: new Date(),
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(departments)
      .values({
        id: P6_DEPT,
        slug: 'p6test-dept',
        nameFa: 'دپارتمان تست گزارش ۶',
        descriptionFa: 'تست گزارش‌های عملیاتی فاز ششم',
        isActive: true,
        isPublic: true,
        assignmentStrategy: 'round_robin',
      })
      .onConflictDoNothing();

    await db
      .insert(departmentMemberships)
      .values({
        id: 'p6test_memb_1',
        userId: P6_OP,
        departmentId: P6_DEPT,
        isManager: false,
        maxActiveTickets: 15,
      })
      .onConflictDoNothing();

    await db
      .insert(customerProfiles)
      .values({
        id: P6_CUSTOMER,
        nationalIdHmac: 'p6test_hmac_0001',
        encryptedNationalId: 'p6test_enc_nid',
        nationalIdLast4: '0001',
        fullName: 'مشتری تست گزارش ۶',
      })
      .onConflictDoNothing();

    const createdAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const resolvedAt = new Date(Date.now() - 60 * 60 * 1000);

    await db
      .insert(tickets)
      .values([
        {
          id: P6_TICKET_OPEN,
          referenceCode: 'P6T-OPEN-01',
          customerProfileId: P6_CUSTOMER,
          departmentId: P6_DEPT,
          assignedOperatorId: P6_OP,
          subject: 'تیکت باز تست فاز ۶',
          status: 'assigned',
          priority: 'high',
          conversationMode: 'assigned_to_operator',
          createdAt,
          lastMessageAt: resolvedAt,
        },
        {
          id: P6_TICKET_RESOLVED,
          referenceCode: 'P6T-RES-02',
          customerProfileId: P6_CUSTOMER,
          departmentId: P6_DEPT,
          assignedOperatorId: P6_OP,
          subject: 'تیکت حل‌شده تست فاز ۶',
          status: 'resolved',
          priority: 'normal',
          conversationMode: 'resolved',
          createdAt,
          resolvedAt,
          lastMessageAt: resolvedAt,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(ticketMessages)
      .values([
        {
          id: 'p6test_tmsg_1',
          ticketId: P6_TICKET_OPEN,
          senderType: 'operator',
          senderUserId: P6_OP,
          visibility: 'public',
          body: 'پاسخ عمومی اپراتور برای تست گزارش',
        },
        {
          id: 'p6test_tmsg_2',
          ticketId: P6_TICKET_OPEN,
          senderType: 'operator',
          senderUserId: P6_OP,
          visibility: 'internal_note',
          body: 'یادداشت داخلی اپراتور برای تست گزارش',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(ticketAssignments)
      .values([
        {
          id: 'p6test_tass_1',
          ticketId: P6_TICKET_OPEN,
          toDepartmentId: P6_DEPT,
          toOperatorId: P6_OP,
          strategyUsed: 'round_robin',
          reason: 'توزیع تست فاز ۶',
        },
        {
          id: 'p6test_tass_2',
          ticketId: P6_TICKET_RESOLVED,
          toDepartmentId: P6_DEPT,
          toOperatorId: P6_OP,
          assignedByUserId: P6_ADMIN,
          strategyUsed: 'manual_reassign',
          reason: 'بازتخصیص تست فاز ۶',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(storedFiles)
      .values({
        id: 'p6test_sfile_1',
        departmentId: P6_DEPT,
        title: 'فایل تست گزارش فاز ۶',
        originalFilename: 'p6test-report.pdf',
        storageKey: 'shared/p6test-nonexistent.pdf',
        mimeType: 'application/pdf',
        fileExtension: '.pdf',
        byteSize: 4096,
        sha256: '0'.repeat(64),
        uploadedByUserId: P6_OP,
      })
      .onConflictDoNothing();

    await db
      .insert(aiUsageLogs)
      .values([
        {
          id: 'p6test_ai_1',
          departmentId: P6_DEPT,
          providerType: 'gemini',
          modelName: 'gemini-4-hydrogen',
          status: 'success',
          promptTokens: 120,
          completionTokens: 45,
          latencyMs: 320,
        },
        {
          id: 'p6test_ai_2',
          departmentId: P6_DEPT,
          providerType: 'gemini',
          modelName: 'gemini-4-hydrogen',
          status: 'abstained',
          promptTokens: 90,
          completionTokens: 20,
          latencyMs: 210,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(auditLogs)
      .values([
        {
          id: P6_AUDIT_1,
          actorType: 'user',
          actorUserId: P6_ADMIN,
          action: 'p6test.policy.checked',
          targetType: 'p6test_target',
          targetId: 'tgt_alpha',
          ipAddress: '127.0.0.1',
          metadataJson: { marker: 'p6test_alpha' },
        },
        {
          id: P6_AUDIT_2,
          actorType: 'system',
          action: 'p6test.cron.ran',
          targetType: 'p6test_job',
          targetId: 'tgt_beta',
          metadataJson: { ok: true },
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(auditLogs)
      .where(
        or(
          like(auditLogs.id, 'p6test_%'),
          eq(auditLogs.actorUserId, P6_ADMIN),
          eq(auditLogs.actorUserId, P6_OP),
          like(auditLogs.action, 'p6test.%')
        )
      );

    await db.delete(aiUsageLogs).where(like(aiUsageLogs.id, 'p6test_%'));
    await db.delete(storedFiles).where(like(storedFiles.id, 'p6test_%'));
    await db.delete(ticketAssignments).where(like(ticketAssignments.id, 'p6test_%'));
    await db.delete(ticketMessages).where(like(ticketMessages.id, 'p6test_%'));
    await db.delete(tickets).where(like(tickets.id, 'p6test_%'));
    await db.delete(customerProfiles).where(eq(customerProfiles.id, P6_CUSTOMER));
    await db
      .delete(departmentMemberships)
      .where(like(departmentMemberships.id, 'p6test_%'));
    await db.delete(departments).where(eq(departments.id, P6_DEPT));
    await db.delete(users).where(or(eq(users.id, P6_ADMIN), eq(users.id, P6_OP)));

    if (hadSettingsRow) {
      await db
        .insert(systemSettings)
        .values({
          key: PLATFORM_SETTINGS_KEY,
          valueJson: originalSettings as unknown as Record<string, unknown>,
          isSensitive: false,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            valueJson: originalSettings as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          },
        });
    } else {
      await db
        .delete(systemSettings)
        .where(eq(systemSettings.key, PLATFORM_SETTINGS_KEY));
    }

    await pool.end();
  });

  it('persists and validates platform system settings cleanly with audit logging', async () => {
    const invalid = platformSettingsSchema.safeParse({
      ...DEFAULT_PLATFORM_SETTINGS,
      brandNameFa: 'ا',
      customerOtpTtlMinutes: 99,
    });
    expect(invalid.success).toBe(false);

    const updated = await updatePlatformSettings({
      actorUserId: P6_ADMIN,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      input: {
        ...DEFAULT_PLATFORM_SETTINGS,
        brandNameFa: 'پشتیبانی تست فاز ۶',
        maintenanceNoticeFa: 'اطلاعیه آزمایشی فاز ششم',
        defaultTicketPriority: 'high',
        customerOtpTtlMinutes: 8,
        showWorkspacesSummary: false,
        themeAccent: 'emerald',
      },
    });

    expect(updated.settings.brandNameFa).toBe('پشتیبانی تست فاز ۶');
    expect(updated.settings.themeAccent).toBe('emerald');

    const reloaded = await getPlatformSettings();
    expect(reloaded.settings.brandNameFa).toBe('پشتیبانی تست فاز ۶');
    expect(reloaded.settings.defaultTicketPriority).toBe('high');
    expect(reloaded.settings.customerOtpTtlMinutes).toBe(8);
    expect(reloaded.settings.showWorkspacesSummary).toBe(false);

    const auditHit = await db.query.auditLogs.findFirst({
      where: eq(auditLogs.actorUserId, P6_ADMIN),
    });
    expect(auditHit).toBeTruthy();
  });

  it('aggregates ticket, assignment, operator activity, and AI reports accurately from PostgreSQL', async () => {
    const report = await getOperationalReports({
      days: 30,
      departmentId: P6_DEPT,
    });

    expect(report.ticketSummary.total).toBe(2);
    expect(report.ticketSummary.open).toBe(1);
    expect(report.ticketSummary.resolved).toBe(1);
    expect(report.ticketSummary.byDepartment).toHaveLength(1);
    expect(report.ticketSummary.byDepartment[0].avgResolveHours).toBeGreaterThan(0);

    expect(report.assignmentReport.totalAssignments).toBe(2);
    expect(
      report.assignmentReport.byStrategy.find((s) => s.strategyUsed === 'round_robin')?.count
    ).toBe(1);
    expect(
      report.assignmentReport.byStrategy.find((s) => s.strategyUsed === 'manual_reassign')?.count
    ).toBe(1);

    const opStat = report.operatorActivity.find((o) => o.userId === P6_OP);
    expect(opStat).toBeDefined();
    expect(opStat?.activeTickets).toBe(1);
    expect(opStat?.resolvedTickets).toBe(1);
    expect(opStat?.publicReplies).toBe(1);
    expect(opStat?.internalNotes).toBe(1);
    expect(opStat?.filesUploaded).toBe(1);
    expect(opStat?.bytesUploaded).toBe(4096);

    expect(report.aiSummary.totalCalls).toBe(2);
    expect(report.aiSummary.successCount).toBe(1);
    expect(report.aiSummary.abstainedCount).toBe(1);
    expect(report.aiSummary.promptTokens).toBe(210);
    expect(report.aiSummary.completionTokens).toBe(65);
  });

  it('neutralizes CSV formula injection payloads and adds UTF-8 BOM', () => {
    expect(sanitizeCsvCell('=SUM(A1:A2)')).toBe(`"'=SUM(A1:A2)"`);
    expect(sanitizeCsvCell('+cmd|calc')).toBe(`"'+cmd|calc"`);
    expect(sanitizeCsvCell('-10+2')).toBe(`"'-10+2"`);
    expect(sanitizeCsvCell('@HYPERLINK("x")')).toBe(`"'@HYPERLINK(""x"")"`);

    const csv = rowsToUtf8Csv(['کد', 'توضیح'], [['=1+1', 'متن "آزمایشی"']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).toContain(`"متن ""آزمایشی"""`);
  });

  it('filters and paginates audit logs without leaking unrelated records', async () => {
    const byAction = await listAuditLogsAdmin({
      action: 'p6test.',
      page: 1,
      pageSize: 10,
    });
    expect(byAction.items.length).toBeGreaterThanOrEqual(2);
    expect(byAction.items.every((item) => item.action.startsWith('p6test.'))).toBe(true);

    const byActorType = await listAuditLogsAdmin({
      action: 'p6test.',
      actorType: 'system',
    });
    expect(byActorType.items).toHaveLength(1);
    expect(byActorType.items[0].id).toBe(P6_AUDIT_2);

    const byQuery = await listAuditLogsAdmin({
      q: 'tgt_alpha',
    });
    expect(byQuery.items.some((item) => item.id === P6_AUDIT_1)).toBe(true);
  });

  it('reports live database, storage, and integration health without exposing secrets', async () => {
    const health = await getSystemHealthDiagnostics();

    expect(health.runtime.phase).toBe(6);
    expect(health.database.ok).toBe(true);
    expect(health.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.storage.ok).toBe(true);
    expect(health.storage.writable).toBe(true);
    expect(health.counts).not.toBeNull();
    expect(health.counts!.users).toBeGreaterThanOrEqual(1);

    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain('encryptedApiKey');
    expect(serialized).not.toContain('BETTER_AUTH_SECRET');
  });
});
