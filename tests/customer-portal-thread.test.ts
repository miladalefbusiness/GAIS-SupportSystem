import 'dotenv/config';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UserAccessProfile } from '../src/core/auth/rbac.ts';
import { resetRateLimitBuckets } from '../src/core/security/rate-limit.ts';
import { db, pool } from '../src/db/index.ts';
import {
  aiConversations,
  aiMessages,
  auditLogs,
  customerProfiles,
  customerSessions,
  departments,
  tickets,
  users,
} from '../src/db/schema.ts';
import { handleCustomerAiMessage } from '../src/modules/ai/chat.ts';
import {
  deleteSystemUserAdmin,
  listSystemUsersAdmin,
  updateSystemUserAdmin,
} from '../src/modules/customers/admin.ts';
import { validateIranianNationalId } from '../src/modules/customers/national-id.ts';
import {
  authenticateCustomerWithPassword,
  getCustomerByRawSessionToken,
  resolveOrCreateCustomerByIdentity,
} from '../src/modules/customers/service.ts';
import {
  createCustomerTicket,
  getOperatorTicketDetail,
} from '../src/modules/tickets/service.ts';

const CPT_DEPT_MAIN = 'cpt_test_dept_main';
const CPT_DEPT_SECRET = 'cpt_test_dept_secret';
const CPT_ADMIN_USER = 'cpt_test_superadmin';
const CPT_VALID_NID = '0013520849';

function buildScopedOperator(deptIds: string[]): UserAccessProfile {
  return {
    userId: CPT_ADMIN_USER,
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
      nameFa: departmentId === CPT_DEPT_MAIN ? 'پشتیبانی اصلی آزمایشی' : 'دپارتمان محرمانه',
      isActive: true,
      isManager: false,
      isAvailable: true,
      maxActiveTickets: 15,
    })),
    isSuperAdmin: false,
  };
}

describe('Passwordless Ticket Submission, Unified National-ID Thread & System Users Admin', () => {
  let createdCustomerId = '';

  beforeAll(async () => {
    resetRateLimitBuckets();
    expect(validateIranianNationalId(CPT_VALID_NID).valid).toBe(true);

    await db
      .insert(users)
      .values({
        id: CPT_ADMIN_USER,
        username: 'cpt_test_admin',
        email: 'cpt_test_admin@local.test',
        name: 'مدیر آزمایشی',
        status: 'active',
      })
      .onConflictDoNothing();

    await db
      .insert(departments)
      .values([
        {
          id: CPT_DEPT_MAIN,
          slug: 'cpt-main-dept',
          nameFa: 'پشتیبانی اصلی آزمایشی',
          descriptionFa: 'تست رشته پیام',
          isPublic: true,
          isActive: true,
          aiEnabled: true,
          assignmentStrategy: 'round_robin',
          maxUploadSizeMb: 5,
        },
        {
          id: CPT_DEPT_SECRET,
          slug: 'cpt-secret-dept',
          nameFa: 'دپارتمان محرمانه آزمایشی',
          descriptionFa: 'تست جداسازی دسترسی دپارتمان',
          isPublic: true,
          isActive: true,
          aiEnabled: false,
          assignmentStrategy: 'round_robin',
          maxUploadSizeMb: 5,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    if (createdCustomerId) {
      await db
        .delete(customerSessions)
        .where(eq(customerSessions.customerProfileId, createdCustomerId));
      await db
        .delete(aiConversations)
        .where(eq(aiConversations.customerProfileId, createdCustomerId));
      await db
        .delete(tickets)
        .where(eq(tickets.customerProfileId, createdCustomerId));
      await db
        .delete(customerProfiles)
        .where(eq(customerProfiles.id, createdCustomerId));
    }
    await db
      .delete(tickets)
      .where(inArray(tickets.departmentId, [CPT_DEPT_MAIN, CPT_DEPT_SECRET]));
    await db
      .delete(aiConversations)
      .where(inArray(aiConversations.departmentId, [CPT_DEPT_MAIN, CPT_DEPT_SECRET]));
    await db
      .delete(departments)
      .where(inArray(departments.id, [CPT_DEPT_MAIN, CPT_DEPT_SECRET]));
    await db.delete(auditLogs).where(like(auditLogs.actorUserId, 'cpt_test%'));
    await db.delete(users).where(eq(users.id, CPT_ADMIN_USER));
    await pool.end();
  });

  it('creates customer profile by national ID + fullName without OTP and handles first-time password flow securely', async () => {
    const identity = await resolveOrCreateCustomerByIdentity({
      nationalId: CPT_VALID_NID,
      fullName: 'علیرضا رضایی تست',
    });
    createdCustomerId = identity.id;

    expect(identity.hasPassword).toBe(false);
    expect(identity.fullName).toBe('علیرضا رضایی تست');

    // Login before password is set must inform user to set first-time password
    await expect(
      authenticateCustomerWithPassword({
        nationalId: CPT_VALID_NID,
        password: 'MySecret123!',
        mode: 'login',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      })
    ).rejects.toThrow('CUSTOMER_NEEDS_FIRST_TIME_PASSWORD');

    // First-time password setup works once and returns valid session token
    const setupRes = await authenticateCustomerWithPassword({
      nationalId: CPT_VALID_NID,
      fullName: 'علیرضا رضایی تست',
      password: 'FirstPass123!',
      mode: 'set_password',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(setupRes.isFirstTimeSetup).toBe(true);
    const verifiedSession = await getCustomerByRawSessionToken(setupRes.rawSessionToken);
    expect(verifiedSession?.customer.id).toBe(createdCustomerId);

    // Re-running set_password must fail once password is already configured
    await expect(
      authenticateCustomerWithPassword({
        nationalId: CPT_VALID_NID,
        fullName: 'مهاجم فرضی',
        password: 'HijackPass123!',
        mode: 'set_password',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      })
    ).rejects.toThrow('PASSWORD_ALREADY_SET');

    // Wrong password rejected
    await expect(
      authenticateCustomerWithPassword({
        nationalId: CPT_VALID_NID,
        password: 'WrongPassword!',
        mode: 'login',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      })
    ).rejects.toThrow('INVALID_CUSTOMER_CREDENTIALS');

    // Correct password succeeds
    const loginRes = await authenticateCustomerWithPassword({
      nationalId: CPT_VALID_NID,
      password: 'FirstPass123!',
      mode: 'login',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(loginRes.isFirstTimeSetup).toBe(false);
    expect(loginRes.customer.id).toBe(createdCustomerId);
  });

  it('unifies customer AI chats and prior tickets in operator threadHistory without leaking National ID or unauthorized departments', async () => {
    // 1. Start an AI chat bound to the customer profile
    const chatTurn = await handleCustomerAiMessage({
      departmentId: CPT_DEPT_MAIN,
      customerProfileId: createdCustomerId,
      message: 'پیام قبلی در گفت‌وگوی دستیار هوشمند درباره مرخصی',
      ipAddress: '127.0.0.1',
    });
    expect(chatTurn.conversationId).toBeTruthy();

    // 2. Submit a direct ticket in main dept
    const ticketOne = await createCustomerTicket({
      customerId: createdCustomerId,
      customerName: 'علیرضا رضایی تست',
      departmentId: CPT_DEPT_MAIN,
      subject: 'تیکت اول کاربر',
      description: 'شرح تیکت قبلی کاربر در دپارتمان اصلی',
      priority: 'normal',
      files: [],
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(ticketOne).not.toBeNull();

    // 3. Submit a ticket in secret dept (operator does NOT have access)
    await createCustomerTicket({
      customerId: createdCustomerId,
      customerName: 'علیرضا رضایی تست',
      departmentId: CPT_DEPT_SECRET,
      subject: 'تیکت محرمانه در دپارتمان دیگر',
      description: 'متن محرمانه دپارتمان دوم',
      priority: 'normal',
      files: [],
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    // 4. Submit current active ticket in main dept
    const ticketCurrent = await createCustomerTicket({
      customerId: createdCustomerId,
      customerName: 'علیرضا رضایی تست',
      departmentId: CPT_DEPT_MAIN,
      subject: 'تیکت جدید کاربر',
      description: 'درخواست جدید روی همان پرونده کد ملی',
      priority: 'high',
      files: [],
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(ticketCurrent).not.toBeNull();

    const operatorAccess = buildScopedOperator([CPT_DEPT_MAIN]);
    const detail = await getOperatorTicketDetail(operatorAccess, ticketCurrent!.id);
    expect(detail).not.toBeNull();

    // Raw 10-digit National ID must NEVER appear in operator ticket detail
    expect(JSON.stringify(detail)).not.toContain(CPT_VALID_NID);

    const historyBodies = (detail!.customer.threadHistory ?? []).map((h) => h.body);
    expect(historyBodies.some((b) => b.includes('شرح تیکت قبلی کاربر در دپارتمان اصلی'))).toBe(true);
    expect(historyBodies.some((b) => b.includes('پیام قبلی در گفت‌وگوی دستیار هوشمند درباره مرخصی'))).toBe(true);
    // Secret department message must NOT leak to main-only operator
    expect(historyBodies.some((b) => b.includes('متن محرمانه دپارتمان دوم'))).toBe(false);
    // Sanity check ticketOne ref
    expect(detail!.customer.recentTicketsInAuthorizedScope.some((t) => t.id === ticketOne!.id)).toBe(true);
  });

  it('allows superadmin to list, edit, reset forgotten password (revoking prior sessions), and delete system users', async () => {
    const usersList = await listSystemUsersAdmin(CPT_VALID_NID);
    const target = usersList.find((u) => u.id === createdCustomerId);
    expect(target).toBeDefined();
    expect(target!.nationalId).toBe(CPT_VALID_NID);
    expect(target!.hasPassword).toBe(true);
    expect(target!.ticketCount).toBeGreaterThanOrEqual(3);
    expect(target!.conversationCount).toBeGreaterThanOrEqual(1);

    // Capture an active session before password reset
    const preResetAuth = await authenticateCustomerWithPassword({
      nationalId: CPT_VALID_NID,
      password: 'FirstPass123!',
      mode: 'login',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(await getCustomerByRawSessionToken(preResetAuth.rawSessionToken)).not.toBeNull();

    // Superadmin updates name & resets forgotten password
    const updated = await updateSystemUserAdmin({
      targetCustomerId: createdCustomerId,
      input: {
        fullName: 'علیرضا رضایی ویرایش‌شده',
        phone: '09121112233',
        newPassword: 'ResetByAdmin99!',
      },
      actorUserId: CPT_ADMIN_USER,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(updated?.fullName).toBe('علیرضا رضایی ویرایش‌شده');
    expect(updated?.phoneMasked).toBeTruthy();

    // Prior session must have been revoked on password reset
    expect(await getCustomerByRawSessionToken(preResetAuth.rawSessionToken)).toBeNull();

    // New password works immediately
    const postResetAuth = await authenticateCustomerWithPassword({
      nationalId: CPT_VALID_NID,
      password: 'ResetByAdmin99!',
      mode: 'login',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(postResetAuth.customer.fullName).toBe('علیرضا رضایی ویرایش‌شده');

    // Superadmin deletes user account and cascades tickets/conversations
    const delResult = await deleteSystemUserAdmin({
      targetCustomerId: createdCustomerId,
      actorUserId: CPT_ADMIN_USER,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(delResult?.ok).toBe(true);
    expect(delResult?.deletedTicketCount).toBeGreaterThanOrEqual(3);

    const remaining = await listSystemUsersAdmin(CPT_VALID_NID);
    expect(remaining.find((u) => u.id === createdCustomerId)).toBeUndefined();
    createdCustomerId = '';
  });
});
