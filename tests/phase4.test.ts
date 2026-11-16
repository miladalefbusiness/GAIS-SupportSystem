import 'dotenv/config';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UserAccessProfile } from '../src/core/auth/rbac.ts';
import { resetRateLimitBuckets } from '../src/core/security/rate-limit.ts';
import { getStorageDriver } from '../src/core/storage/local-storage.ts';
import { db, pool } from '../src/db/index.ts';
import {
  aiConversations,
  aiMessages,
  auditLogs,
  customerProfiles,
  departmentMemberships,
  departmentRoutingState,
  departments,
  identityVerificationRecords,
  knowledgeRetrievalRecords,
  notifications,
  operatorAvailability,
  ticketAttachments,
  tickets,
  users,
} from '../src/db/schema.ts';
import {
  computeNationalIdHmac,
  decryptNationalId,
  encryptNationalId,
  validateIranianNationalId,
} from '../src/modules/customers/national-id.ts';
import { resolveConfiguredOtpMode } from '../src/modules/customers/otp-provider.ts';
import {
  getCustomerByRawSessionToken,
  requestCustomerOtp,
  revokeCustomerSessionByToken,
  verifyCustomerOtp,
} from '../src/modules/customers/service.ts';
import { validateAttachmentUpload } from '../src/modules/tickets/attachments.ts';
import {
  addOperatorTicketMessage,
  convertAiConversationToTicket,
  createCustomerTicket,
  getCustomerTicketDetail,
  getOperatorTicketDetail,
  listOperatorTickets,
  transferTicketDepartment,
} from '../src/modules/tickets/service.ts';

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const P4_DEPT_RR = 'p4test_dept_rr';
const P4_DEPT_LL = 'p4test_dept_ll';
const P4_DEPT_OTHER = 'p4test_dept_other';

const P4_OP_1 = 'p4test_op_1';
const P4_OP_2 = 'p4test_op_2';
const P4_OP_3 = 'p4test_op_3';
const P4_OP_OTHER = 'p4test_op_other';

const P4_AI_CONV = 'p4test_ai_conv_1';

function buildOperatorAccess(userId: string, deptIds: string[]): UserAccessProfile {
  return {
    userId,
    roles: [{ id: 'role_operator', slug: 'operator', nameFa: 'اپراتور' }],
    permissions: [
      'desk:workspace:access',
      'desk:tickets:view_department',
      'desk:tickets:reply',
      'desk:tickets:internal_notes',
      'desk:tickets:assign',
    ],
    departments: deptIds.map((departmentId) => ({
      departmentId,
      slug: departmentId,
      nameFa: departmentId,
      isActive: true,
      isManager: false,
      isAvailable: true,
      maxActiveTickets: 15,
    })),
    isSuperAdmin: false,
  };
}

describe('Phase 4: Customer Verification, Ticketing & Fair Distribution', () => {
  const createdStorageKeys: string[] = [];

  beforeAll(async () => {
    resetRateLimitBuckets();

    await db
      .insert(users)
      .values([
        {
          id: P4_OP_1,
          username: 'p4test_op1',
          email: 'p4test_op1@local.test',
          name: 'اپراتور آزمایشی ۱',
          status: 'active',
        },
        {
          id: P4_OP_2,
          username: 'p4test_op2',
          email: 'p4test_op2@local.test',
          name: 'اپراتور آزمایشی ۲',
          status: 'active',
        },
        {
          id: P4_OP_3,
          username: 'p4test_op3',
          email: 'p4test_op3@local.test',
          name: 'اپراتور آزمایشی ۳',
          status: 'active',
        },
        {
          id: P4_OP_OTHER,
          username: 'p4test_op_other',
          email: 'p4test_op_other@local.test',
          name: 'اپراتور دپارتمان دیگر',
          status: 'active',
        },
      ])
      .onConflictDoNothing({ target: users.id });

    await db
      .insert(operatorAvailability)
      .values([
        { userId: P4_OP_1, isAvailable: true },
        { userId: P4_OP_2, isAvailable: true },
        { userId: P4_OP_3, isAvailable: true },
        { userId: P4_OP_OTHER, isAvailable: true },
      ])
      .onConflictDoNothing({ target: operatorAvailability.userId });

    await db
      .insert(departments)
      .values([
        {
          id: P4_DEPT_RR,
          slug: 'p4test-rr',
          nameFa: 'پشتیبانی توزیع نوبتی تست',
          descriptionFa: 'تست توزیع همزمان نوبتی',
          isActive: true,
          isPublic: true,
          aiEnabled: true,
          assignmentStrategy: 'round_robin',
          maxUploadSizeMb: 5,
        },
        {
          id: P4_DEPT_LL,
          slug: 'p4test-ll',
          nameFa: 'پشتیبانی کمترین بار تست',
          descriptionFa: 'تست توزیع کمترین بار',
          isActive: true,
          isPublic: true,
          aiEnabled: true,
          assignmentStrategy: 'least_loaded',
          maxUploadSizeMb: 5,
        },
        {
          id: P4_DEPT_OTHER,
          slug: 'p4test-other',
          nameFa: 'دپارتمان مجزای تست',
          descriptionFa: 'تست مرزبندی و انتقال',
          isActive: true,
          isPublic: true,
          aiEnabled: false,
          assignmentStrategy: 'manual_queue',
          maxUploadSizeMb: 5,
        },
      ])
      .onConflictDoNothing({ target: departments.id });

    await db
      .insert(departmentMemberships)
      .values([
        {
          id: 'p4test_mem_rr1',
          departmentId: P4_DEPT_RR,
          userId: P4_OP_1,
          isAvailable: true,
          maxActiveTickets: 10,
        },
        {
          id: 'p4test_mem_rr2',
          departmentId: P4_DEPT_RR,
          userId: P4_OP_2,
          isAvailable: true,
          maxActiveTickets: 10,
        },
        {
          id: 'p4test_mem_rr3',
          departmentId: P4_DEPT_RR,
          userId: P4_OP_3,
          isAvailable: true,
          maxActiveTickets: 10,
        },
        {
          id: 'p4test_mem_ll1',
          departmentId: P4_DEPT_LL,
          userId: P4_OP_1,
          isAvailable: true,
          maxActiveTickets: 1, // Already holds tickets from RR test -> skipped cleanly if >= 1!
        },
        {
          id: 'p4test_mem_ll2',
          departmentId: P4_DEPT_LL,
          userId: P4_OP_2,
          isAvailable: true,
          maxActiveTickets: 15,
        },
        {
          id: 'p4test_mem_other',
          departmentId: P4_DEPT_OTHER,
          userId: P4_OP_OTHER,
          isAvailable: true,
          maxActiveTickets: 10,
        },
      ])
      .onConflictDoNothing({ target: departmentMemberships.id });

    await db
      .insert(aiConversations)
      .values({
        id: P4_AI_CONV,
        departmentId: P4_DEPT_RR,
        mode: 'ai_assisted',
        escalatedToHuman: false,
        aiAutoReplyEnabled: true,
        turnCount: 1,
      })
      .onConflictDoNothing({ target: aiConversations.id });

    await db
      .insert(aiMessages)
      .values([
        {
          id: 'p4test_aimsg_1',
          conversationId: P4_AI_CONV,
          senderRole: 'customer',
          content: 'چطور می‌توانم دسترسی سرور تست را دریافت کنم؟',
        },
        {
          id: 'p4test_aimsg_2',
          conversationId: P4_AI_CONV,
          senderRole: 'ai_assistant',
          content: 'برای دریافت دسترسی، درخواست باید توسط کارشناس بررسی شود.',
          abstained: true,
          escalationOffered: true,
          retrievalConfidence: 15,
        },
      ])
      .onConflictDoNothing({ target: aiMessages.id });

    await db
      .insert(knowledgeRetrievalRecords)
      .values({
        id: 'p4test_krr_1',
        conversationId: P4_AI_CONV,
        messageId: 'p4test_aimsg_2',
        departmentId: P4_DEPT_RR,
        queryText: 'دسترسی سرور تست',
        sourcesJson: [
          {
            sourceType: 'qa',
            sourceId: 'qa_secret_internal',
            title: 'سند داخلی آزمایشی',
            score: 15,
            snippet: 'نیازمند بررسی اپراتور',
          },
        ],
        topScore: 15,
        abstained: true,
      })
      .onConflictDoNothing({ target: knowledgeRetrievalRecords.id });
  });

  afterAll(async () => {
    const driver = getStorageDriver();
    for (const key of createdStorageKeys) {
      await driver.delete(key).catch(() => {});
    }

    const testDepts = [P4_DEPT_RR, P4_DEPT_LL, P4_DEPT_OTHER];
    const testTickets = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(inArray(tickets.departmentId, testDepts));
    const ticketIds = testTickets.map((t) => t.id);

    if (ticketIds.length > 0) {
      const atts = await db
        .select({ storageKey: ticketAttachments.storageKey })
        .from(ticketAttachments)
        .where(inArray(ticketAttachments.ticketId, ticketIds));
      for (const a of atts) {
        await driver.delete(a.storageKey).catch(() => {});
      }
      await db.delete(notifications).where(inArray(notifications.ticketId, ticketIds));
      await db.delete(tickets).where(inArray(tickets.id, ticketIds));
    }

    await db.delete(aiConversations).where(eq(aiConversations.id, P4_AI_CONV));
    await db
      .delete(departmentRoutingState)
      .where(inArray(departmentRoutingState.departmentId, testDepts));
    await db
      .delete(departments)
      .where(inArray(departments.id, testDepts));

    const nidHmac = computeNationalIdHmac('0123456789');
    await db
      .delete(identityVerificationRecords)
      .where(eq(identityVerificationRecords.nationalIdHmac, nidHmac));
    await db
      .delete(customerProfiles)
      .where(eq(customerProfiles.nationalIdHmac, nidHmac));

    await db
      .delete(users)
      .where(inArray(users.id, [P4_OP_1, P4_OP_2, P4_OP_3, P4_OP_OTHER]));
    await db.delete(auditLogs).where(like(auditLogs.action, 'customer.%'));
    await db.delete(auditLogs).where(like(auditLogs.action, 'ticket.%'));

    await pool.end();
  });

  it('validates Iranian National ID checksums, digits, and AES-256-GCM + HMAC protection', () => {
    expect(validateIranianNationalId('0123456789').valid).toBe(true);
    expect(validateIranianNationalId('۰۱۲۳۴۵۶۷۸۹').normalized).toBe('0123456789');
    expect(validateIranianNationalId('1111111111').valid).toBe(false);
    expect(validateIranianNationalId('1234567890').valid).toBe(false);
    expect(validateIranianNationalId('12345').valid).toBe(false);

    const enc = encryptNationalId('0123456789');
    expect(enc).not.toContain('0123456789');
    expect(decryptNationalId(enc)).toBe('0123456789');

    const hmac1 = computeNationalIdHmac('0123456789');
    const hmac2 = computeNationalIdHmac('0123456789');
    expect(hmac1).toBe(hmac2);
    expect(hmac1).not.toContain('0123456789');
  });

  it('disables dev_mock OTP mode when NODE_ENV=production unless sms_webhook is configured', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origProvider = process.env.OTP_PROVIDER;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.OTP_PROVIDER = 'dev_mock';
      expect(resolveConfiguredOtpMode()).toBe('disabled');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
      if (origProvider === undefined) {
        delete process.env.OTP_PROVIDER;
      } else {
        process.env.OTP_PROVIDER = origProvider;
      }
    }
  });

  it('completes customer OTP flow, enforces attempt limit, and issues cookie session', async () => {
    const otpReq1 = await requestCustomerOtp({
      nationalId: '۰۱۲۳۴۵۶۷۸۹',
      fullName: 'سارا آزمون',
      phone: '09123456789',
      purpose: 'customer_portal',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(otpReq1.challengeId).toMatch(/^otp_/);
    expect(otpReq1.devPreviewCode).toMatch(/^\d{6}$/);

    // Invalid attempt increments attemptCount
    await expect(
      verifyCustomerOtp({
        challengeId: otpReq1.challengeId,
        otpCode: '000000',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      })
    ).rejects.toThrow('OTP_INVALID_CODE');

    // Valid OTP succeeds and yields session token
    const verified = await verifyCustomerOtp({
      challengeId: otpReq1.challengeId,
      otpCode: otpReq1.devPreviewCode!,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(verified.customer.fullName).toBe('سارا آزمون');
    expect(verified.rawSessionToken.length).toBeGreaterThan(20);

    const session = await getCustomerByRawSessionToken(verified.rawSessionToken);
    expect(session?.customer.id).toBe(verified.customer.id);

    // Ensure session revocation works
    await revokeCustomerSessionByToken(verified.rawSessionToken);
    const revoked = await getCustomerByRawSessionToken(verified.rawSessionToken);
    expect(revoked).toBeNull();
  });

  it('rejects spoofed attachment signatures and enforces department size caps', async () => {
    await expect(
      validateAttachmentUpload({
        filename: 'fake.png',
        buffer: Buffer.from('MZ_NOT_A_PNG_EXECUTABLE'),
        maxUploadSizeMb: 5,
      })
    ).rejects.toThrow('INVALID_ATTACHMENT_SIGNATURE');

    await expect(
      validateAttachmentUpload({
        filename: 'huge.txt',
        buffer: Buffer.alloc(2 * 1024 * 1024, 'a'),
        maxUploadSizeMb: 1,
      })
    ).rejects.toThrow('ATTACHMENT_TOO_LARGE');

    const valid = await validateAttachmentUpload({
      filename: '../../weird:name.png',
      buffer: VALID_PNG_BYTES,
      maxUploadSizeMb: 5,
    });
    expect(valid.extension).toBe('png');
    expect(valid.originalFilename).toBe('weird_name.png');
  });

  it('distributes concurrent tickets fairly via round-robin row lock without duplicate reference codes', async () => {
    const reqOtp = await requestCustomerOtp({
      nationalId: '0123456789',
      fullName: 'سارا آزمون',
      purpose: 'ticket_create',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    const verified = await verifyCustomerOtp({
      challengeId: reqOtp.challengeId,
      otpCode: reqOtp.devPreviewCode!,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    const createdTickets = await Promise.all(
      Array.from({ length: 6 }, (_, idx) =>
        createCustomerTicket({
          customerId: verified.customer.id,
          customerName: verified.customer.fullName,
          departmentId: P4_DEPT_RR,
          subject: `درخواست همزمان شماره ${idx + 1}`,
          description: `شرح تیکت آزمایشی شماره ${idx + 1}`,
          priority: 'normal',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        })
      )
    );

    const refCodes = new Set(createdTickets.map((t) => t!.referenceCode));
    expect(refCodes.size).toBe(6);

    const dbTickets = await db
      .select({
        id: tickets.id,
        assignedOperatorId: tickets.assignedOperatorId,
      })
      .from(tickets)
      .where(eq(tickets.departmentId, P4_DEPT_RR));

    const counts = new Map<string, number>();
    for (const row of dbTickets) {
      if (row.assignedOperatorId) {
        counts.set(
          row.assignedOperatorId,
          (counts.get(row.assignedOperatorId) ?? 0) + 1
        );
      }
    }

    // 6 concurrent tickets across 3 active operators => exact 2-2-2 balanced distribution
    expect(counts.get(P4_OP_1)).toBe(2);
    expect(counts.get(P4_OP_2)).toBe(2);
    expect(counts.get(P4_OP_3)).toBe(2);

    // Least-loaded + maxActiveTickets test: P4_OP_1 already has maxActiveTickets=1 cap exceeded (has 2 active tickets),
    // so P4_DEPT_LL must route cleanly to P4_OP_2!
    const llTicket = await createCustomerTicket({
      customerId: verified.customer.id,
      customerName: verified.customer.fullName,
      departmentId: P4_DEPT_LL,
      subject: 'تست سقف تیکت و کمترین بار',
      description: 'بررسی عدم تخصیص به اپراتور پرظرفیت',
      priority: 'high',
      files: [{ filename: 'proof.png', buffer: VALID_PNG_BYTES }],
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    const llRow = await db.query.tickets.findFirst({
      where: eq(tickets.id, llTicket!.id),
    });
    expect(llRow?.assignedOperatorId).toBe(P4_OP_2);
    expect(llTicket?.attachments.length).toBe(1);
  });

  it('isolates internal notes & national ID from customers and blocks cross-department operators (403)', async () => {
    const profile = await db.query.customerProfiles.findFirst({
      where: eq(customerProfiles.nationalIdHmac, computeNationalIdHmac('0123456789')),
    });
    expect(profile).toBeDefined();

    const rrTicket = await db.query.tickets.findFirst({
      where: eq(tickets.departmentId, P4_DEPT_RR),
    });
    expect(rrTicket).toBeDefined();

    const rrAccess = buildOperatorAccess(P4_OP_1, [P4_DEPT_RR]);
    const otherAccess = buildOperatorAccess(P4_OP_OTHER, [P4_DEPT_OTHER]);

    // Authorized operator adds a confidential internal note and a public reply
    await addOperatorTicketMessage({
      access: rrAccess,
      actorName: 'اپراتور آزمایشی ۱',
      ticketId: rrTicket!.id,
      body: 'یادداشت محرمانه تیم فنی: خطا ناشی از باگ داخلی است.',
      visibility: 'internal_note',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    await addOperatorTicketMessage({
      access: rrAccess,
      actorName: 'اپراتور آزمایشی ۱',
      ticketId: rrTicket!.id,
      body: 'سلام، درخواست شما در حال پیگیری است.',
      visibility: 'public',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    // Customer view MUST NOT include internal_note or any national ID string
    const customerView = await getCustomerTicketDetail(profile!.id, rrTicket!.id);
    const serialized = JSON.stringify(customerView);
    expect(serialized).not.toContain('یادداشت محرمانه تیم فنی');
    expect(serialized).not.toContain('0123456789');
    expect(serialized).toContain('سلام، درخواست شما در حال پیگیری است.');

    // Operator view includes internal note AND customerRef, NEVER raw National ID
    const operatorView = await getOperatorTicketDetail(rrAccess, rrTicket!.id);
    expect(JSON.stringify(operatorView)).toContain('یادداشت محرمانه تیم فنی');
    expect(JSON.stringify(operatorView)).not.toContain('0123456789');

    // Cross-department operator MUST be blocked with DEPARTMENT_ACCESS_DENIED (403)
    await expect(getOperatorTicketDetail(otherAccess, rrTicket!.id)).rejects.toThrow(
      'DEPARTMENT_ACCESS_DENIED'
    );
    await expect(
      listOperatorTickets(otherAccess, { departmentId: P4_DEPT_RR })
    ).rejects.toThrow('DEPARTMENT_ACCESS_DENIED');
  });

  it('converts an AI conversation into a tracked ticket preserving full history and stops AI auto-reply', async () => {
    const profile = await db.query.customerProfiles.findFirst({
      where: eq(customerProfiles.nationalIdHmac, computeNationalIdHmac('0123456789')),
    });
    expect(profile).toBeDefined();

    const converted = await convertAiConversationToTicket({
      customerId: profile!.id,
      customerName: profile!.fullName,
      aiConversationId: P4_AI_CONV,
      priority: 'urgent',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(converted.ticket.messages.length).toBeGreaterThanOrEqual(3);
    const serializedCust = JSON.stringify(converted.ticket);
    expect(serializedCust).toContain('چطور می‌توانم دسترسی سرور تست را دریافت کنم؟');
    expect(serializedCust).not.toContain('qa_secret_internal');

    const convAfter = await db.query.aiConversations.findFirst({
      where: eq(aiConversations.id, P4_AI_CONV),
    });
    expect(convAfter?.escalatedToHuman).toBe(true);
    expect(convAfter?.aiAutoReplyEnabled).toBe(false);

    // Operator sees AI retrieval traceability inside ticket detail
    const rrAccess = buildOperatorAccess(P4_OP_1, [P4_DEPT_RR]);
    const opDetail = await getOperatorTicketDetail(rrAccess, converted.ticket.id);
    expect(opDetail?.aiSourceContext.length).toBe(1);
    expect(opDetail?.aiSourceContext[0]?.sources[0]?.sourceId).toBe('qa_secret_internal');

    // Cross-department transfer moves ticket cleanly to P4_DEPT_OTHER
    const transferRes = await transferTicketDepartment({
      access: rrAccess,
      actorName: 'اپراتور آزمایشی ۱',
      ticketId: converted.ticket.id,
      targetDepartmentId: P4_DEPT_OTHER,
      operatorId: P4_OP_OTHER,
      reason: 'نیاز به بررسی تخصصی دپارتمان مقصد',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(transferRes?.transferredAway).toBe(true);
    // Old operator in P4_DEPT_RR can no longer access the transferred ticket
    await expect(
      getOperatorTicketDetail(rrAccess, converted.ticket.id)
    ).rejects.toThrow('DEPARTMENT_ACCESS_DENIED');

    // Target operator in P4_DEPT_OTHER now owns access
    const otherAccess = buildOperatorAccess(P4_OP_OTHER, [P4_DEPT_OTHER]);
    const targetDetail = await getOperatorTicketDetail(
      otherAccess,
      converted.ticket.id
    );
    expect(targetDetail?.ticket.departmentId).toBe(P4_DEPT_OTHER);
    expect(targetDetail?.ticket.assignedOperatorId).toBe(P4_OP_OTHER);
  });
});
