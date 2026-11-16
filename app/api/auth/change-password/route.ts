import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { and, eq, ne } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractRequestContext, recordAuditLog } from '@/src/core/audit/audit.ts';
import { requireAuth } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { checkRateLimit } from '@/src/core/security/rate-limit.ts';
import { db } from '@/src/db/index.ts';
import { authAccounts, authSessions, users } from '@/src/db/schema.ts';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'رمز عبور فعلی الزامی است'),
    newPassword: z
      .string()
      .min(10, 'رمز عبور جدید باید حداقل ۱۰ کاراکتر باشد')
      .max(128)
      .regex(/[A-Za-z]/, 'رمز عبور باید شامل حروف لاتین باشد')
      .regex(/[0-9]/, 'رمز عبور باید شامل حداقل یک عدد باشد'),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'رمز عبور جدید نباید با رمز عبور فعلی یکسان باشد.',
    path: ['newPassword'],
  });

export async function POST(req: NextRequest) {
  const authResult = await requireAuth({ allowPasswordChangeRequired: true });
  if (!authResult.ok) return authResult.response;

  const { session } = authResult;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  const rate = checkRateLimit(
    `pw-change:${session.user.id}:${ipAddress || 'local'}`,
    10,
    15 * 60_000
  );
  if (!rate.allowed) {
    await recordAuditLog({
      actorUserId: session.user.id,
      action: 'auth.password_change.rate_limited',
      targetType: 'user',
      targetId: session.user.id,
      ipAddress,
      userAgent,
    });
    return NextResponse.json(
      { error: 'تعداد درخواست‌های تغییر رمز بیش از حد مجاز است. لطفاً کمی صبر کنید.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const body = await req.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات رمز عبور نامعتبر است.' },
        { status: 400 }
      );
    }

    const credAccount = await db.query.authAccounts.findFirst({
      where: and(
        eq(authAccounts.userId, session.user.id),
        eq(authAccounts.providerId, 'credential')
      ),
    });

    if (!credAccount?.password) {
      return NextResponse.json(
        { error: 'حساب رمز عبور برای این کاربر یافت نشد.' },
        { status: 400 }
      );
    }

    const isCurrentValid = await verifyPassword({
      hash: credAccount.password,
      password: parsed.data.currentPassword,
    });

    if (!isCurrentValid) {
      await recordAuditLog({
        actorUserId: session.user.id,
        action: 'auth.password_change.failed',
        targetType: 'user',
        targetId: session.user.id,
        ipAddress,
        userAgent,
      });
      return NextResponse.json(
        { error: 'رمز عبور فعلی نادرست است.' },
        { status: 400 }
      );
    }

    const newHash = await hashPassword(parsed.data.newPassword);

    await db.transaction(async (tx) => {
      await tx
        .update(authAccounts)
        .set({ password: newHash, updatedAt: new Date() })
        .where(eq(authAccounts.id, credAccount.id));

      await tx
        .update(users)
        .set({ mustChangePassword: false, updatedAt: new Date() })
        .where(eq(users.id, session.user.id));

      // Revoke other active sessions for this user upon password rotation
      await tx
        .delete(authSessions)
        .where(
          and(
            eq(authSessions.userId, session.user.id),
            ne(authSessions.id, session.sessionId)
          )
        );
    });

    await recordAuditLog({
      actorUserId: session.user.id,
      action: 'auth.password_change.success',
      targetType: 'user',
      targetId: session.user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('auth.password_change.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در تغییر رمز عبور.' },
      { status: 500 }
    );
  }
}
