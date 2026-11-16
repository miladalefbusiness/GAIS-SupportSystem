import { randomUUID } from 'node:crypto';
import { eq, or, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractRequestContext, recordAuditLog } from '@/src/core/audit/audit.ts';
import { APP_SESSION_COOKIE, createDbSession } from '@/src/core/auth/auth.ts';
import { buildSessionCookieOptions } from '@/src/core/auth/cookie-options.ts';
import { runInitialBootstrap } from '@/src/core/bootstrap/superadmin.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { checkRateLimit } from '@/src/core/security/rate-limit.ts';
import { db } from '@/src/db/index.ts';
import { authAccounts, roles, userRoles, users } from '@/src/db/schema.ts';
import { adminAuth } from '@/src/lib/firebase-admin.ts';

const firebaseLoginSchema = z.object({
  idToken: z.string().min(20),
});

export async function POST(req: NextRequest) {
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const rate = checkRateLimit(`firebase_auth:${ipAddress || 'local'}`, 20, 15 * 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'تعداد درخواست‌های احراز هویت بیش از حد مجاز است.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json();
    const parsed = firebaseLoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'توکن نامعتبر است.' }, { status: 400 });
    }

    const decoded = await adminAuth.verifyIdToken(parsed.data.idToken);
    if (!decoded.uid || !decoded.email) {
      return NextResponse.json(
        { error: 'اطلاعات ایمیل در حساب گوگل تایید نشده است.' },
        { status: 400 }
      );
    }

    // Ensure RBAC roles exist before linking/creating user
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(roles);
    if (count === 0) {
      await runInitialBootstrap();
    }

    const normalizedEmail = decoded.email.trim().toLowerCase();

    let user = await db.query.users.findFirst({
      where: or(
        eq(users.firebaseUid, decoded.uid),
        eq(users.email, normalizedEmail)
      ),
    });

    if (!user) {
      const generatedUsername = `g_${decoded.uid.slice(0, 10).toLowerCase()}`;
      const newUserId = randomUUID();

      await db.transaction(async (tx) => {
        await tx
          .insert(users)
          .values({
            id: newUserId,
            username: generatedUsername,
            displayUsername: generatedUsername,
            email: normalizedEmail,
            emailVerified: Boolean(decoded.email_verified),
            name: decoded.name || normalizedEmail.split('@')[0],
            image: decoded.picture || null,
            firebaseUid: decoded.uid,
            status: 'active',
            mustChangePassword: false,
            isBootstrapAdmin: false,
          })
          .onConflictDoUpdate({
            target: users.email,
            set: {
              firebaseUid: decoded.uid,
              emailVerified: Boolean(decoded.email_verified),
              updatedAt: new Date(),
            },
          });

        const resolvedUser = await tx.query.users.findFirst({
          where: eq(users.email, normalizedEmail),
        });
        if (!resolvedUser) {
          throw new Error('Failed to upsert Firebase user.');
        }

        await tx
          .insert(authAccounts)
          .values({
            id: randomUUID(),
            accountId: decoded.uid,
            providerId: 'firebase_google',
            userId: resolvedUser.id,
          })
          .onConflictDoNothing();

        // Deny-by-default: assign 'viewer' role (zero operational privileges) until promoted by Super Admin
        const viewerRole = await tx.query.roles.findFirst({
          where: eq(roles.slug, 'viewer'),
        });
        if (viewerRole) {
          await tx
            .insert(userRoles)
            .values({ userId: resolvedUser.id, roleId: viewerRole.id })
            .onConflictDoNothing();
        }
      });

      user = await db.query.users.findFirst({
        where: eq(users.email, normalizedEmail),
      });
    } else if (!user.firebaseUid) {
      await db
        .update(users)
        .set({
          firebaseUid: decoded.uid,
          emailVerified: Boolean(decoded.email_verified) || user.emailVerified,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    }

    if (!user || user.status !== 'active') {
      return NextResponse.json(
        { error: 'حساب کاربری غیرفعال یا مسدود است.' },
        { status: 403 }
      );
    }

    const session = await createDbSession({
      userId: user.id,
      authMethod: 'firebase_google',
      ipAddress,
      userAgent,
    });

    await recordAuditLog({
      actorUserId: user.id,
      action: 'auth.login.firebase_google',
      targetType: 'user',
      targetId: user.id,
      ipAddress,
      userAgent,
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

    response.cookies.set(
      APP_SESSION_COOKIE,
      session.token,
      buildSessionCookieOptions(req, { expires: session.expiresAt })
    );

    return response;
  } catch (error) {
    logger.error('auth.firebase.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'احراز هویت گوگل ناموفق بود.' },
      { status: 401 }
    );
  }
}
