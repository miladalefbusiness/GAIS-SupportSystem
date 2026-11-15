import { verifyPassword } from 'better-auth/crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractRequestContext, recordAuditLog } from '@/src/core/audit/audit.ts';
import { APP_SESSION_COOKIE, createDbSession } from '@/src/core/auth/auth.ts';
import { runInitialBootstrap } from '@/src/core/bootstrap/superadmin.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { checkRateLimit } from '@/src/core/security/rate-limit.ts';
import { db } from '@/src/db/index.ts';
import { authAccounts, users } from '@/src/db/schema.ts';

const loginSchema = z.object({
  identifier: z.string().trim().min(2, 'نام کاربری یا ایمیل الزامی است').max(150),
  password: z.string().min(1, 'رمز عبور الزامی است').max(128),
});

export async function POST(req: NextRequest) {
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'ورودی نامعتبر است.' },
        { status: 400 }
      );
    }

    const identifier = parsed.data.identifier.toLowerCase();
    const rate = checkRateLimit(`login:${ipAddress || 'local'}:${identifier}`, 10, 15 * 60_000);
    if (!rate.allowed) {
      await recordAuditLog({
        actorType: 'anonymous',
        action: 'auth.login.rate_limited',
        ipAddress,
        userAgent,
        metadata: { identifier },
      });
      return NextResponse.json(
        {
          error: 'تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً دقایقی دیگر تلاش کنید.',
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        }
      );
    }

    // Ensure first-time bootstrap runs safely ONLY if users table is currently empty
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    if (count === 0) {
      await runInitialBootstrap();
    }

    const user = await db.query.users.findFirst({
      where: or(eq(users.username, identifier), eq(users.email, identifier)),
    });

    if (!user) {
      await recordAuditLog({
        actorType: 'anonymous',
        action: 'auth.login.failed',
        ipAddress,
        userAgent,
        metadata: { identifier, reason: 'user_not_found' },
      });
      return NextResponse.json(
        { error: 'نام کاربری یا رمز عبور نادرست است.' },
        { status: 401 }
      );
    }

    if (user.status !== 'active') {
      await recordAuditLog({
        actorUserId: user.id,
        action: 'auth.login.blocked',
        targetType: 'user',
        targetId: user.id,
        ipAddress,
        userAgent,
        metadata: { status: user.status },
      });
      return NextResponse.json(
        { error: 'حساب کاربری شما غیرفعال یا معلق شده است.' },
        { status: 403 }
      );
    }

    const credAccount = await db.query.authAccounts.findFirst({
      where: and(
        eq(authAccounts.userId, user.id),
        eq(authAccounts.providerId, 'credential')
      ),
    });

    if (!credAccount?.password) {
      return NextResponse.json(
        { error: 'برای این حساب ورود با رمز عبور فعال نیست. از ورود گوگل استفاده کنید.' },
        { status: 401 }
      );
    }

    const validPassword = await verifyPassword({
      hash: credAccount.password,
      password: parsed.data.password,
    });

    if (!validPassword) {
      await recordAuditLog({
        actorUserId: user.id,
        action: 'auth.login.failed',
        targetType: 'user',
        targetId: user.id,
        ipAddress,
        userAgent,
        metadata: { reason: 'invalid_password' },
      });
      return NextResponse.json(
        { error: 'نام کاربری یا رمز عبور نادرست است.' },
        { status: 401 }
      );
    }

    const session = await createDbSession({
      userId: user.id,
      authMethod: 'credentials',
      ipAddress,
      userAgent,
    });

    await recordAuditLog({
      actorUserId: user.id,
      action: 'auth.login.success',
      targetType: 'user',
      targetId: user.id,
      ipAddress,
      userAgent,
      metadata: { authMethod: 'credentials' },
    });

    const response = NextResponse.json({
      ok: true,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
      },
    });

    response.cookies.set(APP_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: session.expiresAt,
    });

    return response;
  } catch (error) {
    logger.error('auth.login.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در پردازش ورود. لطفاً دوباره تلاش کنید.' },
      { status: 500 }
    );
  }
}
