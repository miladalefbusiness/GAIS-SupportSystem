import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { username } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { db } from '../../db/index.ts';
import {
  authAccounts,
  authSessions,
  authVerifications,
  users,
} from '../../db/schema.ts';
import { getAuthSecret } from '../config/env.ts';
import { getUserAccessProfile, type UserAccessProfile } from './rbac.ts';

export const APP_SESSION_COOKIE = 'supportdesk_session';

const trustedOrigins = [
  'http://localhost:3000',
  ...(process.env.APP_URL ? [process.env.APP_URL] : []),
];

export const auth = betterAuth({
  secret: getAuthSecret(),
  baseURL: process.env.APP_URL || 'http://localhost:3000',
  trustedOrigins,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 hours
    updateAge: 60 * 60, // refresh every 1 hour
    cookieCache: {
      enabled: false, // Always validate session against PostgreSQL for immediate revocation
    },
  },
  advanced: {
    cookiePrefix: 'supportdesk',
    useSecureCookies: process.env.NODE_ENV === 'production',
    database: {
      generateId: () => randomUUID(),
    },
  },
  user: {
    additionalFields: {
      username: { type: 'string', required: true },
      displayUsername: { type: 'string', required: false },
      status: { type: 'string', required: false, defaultValue: 'active' },
      mustChangePassword: { type: 'boolean', required: false, defaultValue: false },
      isBootstrapAdmin: { type: 'boolean', required: false, defaultValue: false },
      firebaseUid: { type: 'string', required: false },
    },
  },
  plugins: [username(), nextCookies()],
});

export interface AuthenticatedSession {
  sessionId: string;
  authMethod: string;
  expiresAt: Date;
  user: {
    id: string;
    username: string;
    email: string;
    name: string;
    status: string;
    mustChangePassword: boolean;
    isBootstrapAdmin: boolean;
    firebaseUid: string | null;
    lastLoginAt: Date | null;
  };
  access: UserAccessProfile;
}

export async function getCurrentSession(): Promise<AuthenticatedSession | null> {
  try {
    const reqHeaders = await headers();
    const baSession = await auth.api.getSession({ headers: reqHeaders });

    if (baSession?.session && baSession?.user) {
      const dbUser = await db.query.users.findFirst({
        where: eq(users.id, baSession.user.id),
      });
      if (!dbUser || dbUser.status !== 'active') {
        return null;
      }
      const access = await getUserAccessProfile(dbUser.id);
      return {
        sessionId: baSession.session.id,
        authMethod: 'better_auth',
        expiresAt: baSession.session.expiresAt,
        user: {
          id: dbUser.id,
          username: dbUser.username,
          email: dbUser.email,
          name: dbUser.name,
          status: dbUser.status,
          mustChangePassword: dbUser.mustChangePassword,
          isBootstrapAdmin: dbUser.isBootstrapAdmin,
          firebaseUid: dbUser.firebaseUid,
          lastLoginAt: dbUser.lastLoginAt,
        },
        access,
      };
    }

    // Fallback check for DB-issued session cookie (e.g., verified Firebase Google Sign-In session)
    const cookieStore = await cookies();
    const customToken = cookieStore.get(APP_SESSION_COOKIE)?.value;
    if (!customToken) {
      return null;
    }

    const sessionRow = await db.query.authSessions.findFirst({
      where: eq(authSessions.token, customToken),
    });

    if (!sessionRow || sessionRow.expiresAt <= new Date()) {
      return null;
    }

    const dbUser = await db.query.users.findFirst({
      where: eq(users.id, sessionRow.userId),
    });
    if (!dbUser || dbUser.status !== 'active') {
      return null;
    }

    const access = await getUserAccessProfile(dbUser.id);
    return {
      sessionId: sessionRow.id,
      authMethod: sessionRow.authMethod,
      expiresAt: sessionRow.expiresAt,
      user: {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        name: dbUser.name,
        status: dbUser.status,
        mustChangePassword: dbUser.mustChangePassword,
        isBootstrapAdmin: dbUser.isBootstrapAdmin,
        firebaseUid: dbUser.firebaseUid,
        lastLoginAt: dbUser.lastLoginAt,
      },
      access,
    };
  } catch {
    return null;
  }
}

export async function createDbSession(params: {
  userId: string;
  authMethod: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = `${randomUUID()}.${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

  await db.insert(authSessions).values({
    id: randomUUID(),
    token,
    userId: params.userId,
    expiresAt,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    authMethod: params.authMethod,
  });

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, params.userId));

  return { token, expiresAt };
}

export async function revokeDbSession(token: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.token, token));
}
