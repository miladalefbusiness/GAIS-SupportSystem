import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { getAppHmacKey } from '@/src/core/config/env.ts';
import { computeKeyedHmac, constantTimeEquals } from '@/src/core/security/crypto.ts';
import { checkRateLimit } from '@/src/core/security/rate-limit.ts';
import { db } from '@/src/db/index.ts';
import { customerProfiles, customerSessions, identityVerificationRecords } from '@/src/db/schema.ts';
import { getPlatformSettings } from '@/src/modules/admin/settings.ts';
import {
  computeNationalIdHmac,
  encryptNationalId,
  normalizeAndValidateIranianMobile,
  normalizeDigits,
  validateIranianNationalId,
} from './national-id.ts';
import { dispatchCustomerOtp, resolveConfiguredOtpMode } from './otp-provider.ts';

export const CUSTOMER_SESSION_COOKIE = 'supportdesk_customer_session';
const DEFAULT_OTP_TTL_MINUTES = 5;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function hashOtpCode(challengeId: string, code: string): string {
  return computeKeyedHmac(`otp:${challengeId}:${code}`, getAppHmacKey());
}

export function hashCustomerSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export interface AuthenticatedCustomer {
  sessionId: string;
  customer: {
    id: string;
    customerRef: string;
    fullName: string;
    phoneMasked: string | null;
    createdAt: string;
  };
}

export async function requestCustomerOtp(params: {
  nationalId: string;
  fullName: string;
  phone?: string | null;
  purpose: 'customer_portal' | 'ticket_create' | 'ticket_handoff';
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const nidResult = validateIranianNationalId(params.nationalId);
  if (!nidResult.valid) {
    throw new Error(`INVALID_NATIONAL_ID:${nidResult.reason}`);
  }

  const nidHmac = computeNationalIdHmac(nidResult.normalized);

  const ipLimit = checkRateLimit(`cust-otp-ip:${params.ipAddress || 'unknown'}`, 12, 5 * 60_000);
  if (!ipLimit.allowed) {
    throw new Error(`RATE_LIMITED:${ipLimit.retryAfterSeconds}`);
  }

  const nidLimit = checkRateLimit(`cust-otp-nid:${nidHmac}`, 5, 5 * 60_000);
  if (!nidLimit.allowed) {
    throw new Error(`RATE_LIMITED:${nidLimit.retryAfterSeconds}`);
  }

  const phoneInfo = normalizeAndValidateIranianMobile(params.phone);

  // Check if customer profile already exists (non-disclosing during OTP request)
  const existingProfile = await db.query.customerProfiles.findFirst({
    where: eq(customerProfiles.nationalIdHmac, nidHmac),
  });

  const { settings } = await getPlatformSettings();
  const otpTtlMinutes = Math.min(
    30,
    Math.max(2, settings.customerOtpTtlMinutes || DEFAULT_OTP_TTL_MINUTES)
  );
  const challengeId = `otp_${randomUUID()}`;
  const rawOtp = String(randomInt(100000, 999999));
  const otpHash = hashOtpCode(challengeId, rawOtp);
  const expiresAt = new Date(Date.now() + otpTtlMinutes * 60 * 1000);
  const mode = resolveConfiguredOtpMode();

  await db.insert(identityVerificationRecords).values({
    id: challengeId,
    customerProfileId: existingProfile?.id ?? null,
    nationalIdHmac: nidHmac,
    fullNameSnapshot: params.fullName.trim(),
    purpose: params.purpose,
    otpCodeHash: otpHash,
    deliveryChannel: mode === 'sms_webhook' ? 'sms_webhook' : 'dev_mock',
    attemptCount: 0,
    maxAttempts: 5,
    expiresAt,
    ipAddress: params.ipAddress,
  });

  const dispatchResult = await dispatchCustomerOtp({
    challengeId,
    fullName: params.fullName.trim(),
    phone: phoneInfo.normalized,
    code: rawOtp,
    purpose: params.purpose,
  });

  await recordAuditLog({
    actorType: 'anonymous',
    action: 'customer.otp.requested',
    targetType: 'identity_verification',
    targetId: challengeId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      purpose: params.purpose,
      channel: dispatchResult.channel,
      nidHmacPrefix: nidHmac.slice(0, 10),
    },
  });

  // Note: encryptedNationalId & phone info will be finalized on verification
  // We do NOT store raw national ID here or in cookies. Keep transient fullName in record;
  // Pass encrypted payload securely in DB or re-supply? Wait: on verify we also need to upsert customerProfiles!
  // Let's make sure we only create customerProfiles cleanly when National ID was encrypted up-front or update profile safely.
  // Actually, upserting a pending/verified profile or encrypting National ID into customerProfiles right away
  // violates nothing since customerProfiles is ONLY accessible after verified OTP session!
  // Better: upsert customerProfiles only AFTER OTP verification if we store encryptedNationalId temporarily,
  // OR upsert customerProfiles now with existing/new data? Wait: if an attacker sends someone else's National ID without verifying OTP,
  // they MUST NOT overwrite the real customer's fullName!
  // Good catch! Let's NOT overwrite existing customerProfiles before OTP verification.
  // Instead, on OTP verification we ONLY update customerProfiles once OTP passes, and if it's a new customer we keep encryptedNationalId
  // inside identityVerificationRecords? Let's keep it clean: we can update customerProfiles using fullNameSnapshot, and if profile doesn't exist
  // wait - can we store encryptedNationalId in identityVerificationRecords OR accept that requestCustomerOtp passes encryptedNationalId,
  // or require nationalId in verify? Even simpler for seamless UX: client only submits { challengeId, otpCode } in verify,
  // so let's keep a short-lived in-memory LRU or derive nothing sensitive? Wait: if server restarts between request & verify, in-memory fails!
  // So let's check: does `customerProfiles` only get created on verify, OR can we add `encryptedPhone`?
  // Wait: if we create `customerProfiles` only when `existingProfile == null`, an unverified request wouldn't overwrite an existing verified customer's name; or we can pass `nationalId` cleanly in `verify`? No, client form has challengeId + otpCode AND already has the nationalId in client state if needed, OR let's check our DB table `identity_verification_records`.
  // Wait: in `identity_verification_records` we have `fullNameSnapshot`, `nationalIdHmac`, `customerProfileId`. If `existingProfile` is null, where does `encryptedNationalId` come from during `verifyCustomerOtp`?
  // Let's check: the verify form / API can optionally accept `nationalId` if new profile, OR even simpler: create the profile row ONLY if none exists with unverified flag? No, `customer_profiles` has `NOT NULL encrypted_national_id, national_id_last4`!
  // Look how clean this is:
  // If `!existingProfile`, inserting an initial `customerProfiles` row inside `requestCustomerOtp` does NOT affect any existing customer (because `nationalIdHmac` is unique and didn't exist!), and NEVER grants a session until OTP is verified! And if `existingProfile` DOES exist, we do NOT modify its `fullName` until `verifyCustomerOtp` succeeds!
  if (!existingProfile) {
    const newProfileId = `cust_${randomUUID()}`;
    await db
      .insert(customerProfiles)
      .values({
        id: newProfileId,
        nationalIdHmac: nidHmac,
        encryptedNationalId: encryptNationalId(nidResult.normalized),
        nationalIdLast4: nidResult.normalized.slice(-4),
        fullName: params.fullName.trim(),
        encryptedPhone: phoneInfo.encrypted,
        phoneMasked: phoneInfo.masked,
      })
      .onConflictDoNothing({ target: customerProfiles.nationalIdHmac });

    const createdProfile = await db.query.customerProfiles.findFirst({
      where: eq(customerProfiles.nationalIdHmac, nidHmac),
    });
    if (createdProfile) {
      await db
        .update(identityVerificationRecords)
        .set({ customerProfileId: createdProfile.id })
        .where(eq(identityVerificationRecords.id, challengeId));
    }
  }

  return {
    challengeId,
    channel: dispatchResult.channel,
    expiresAt: expiresAt.toISOString(),
    devPreviewCode: dispatchResult.devPreviewCode,
  };
}

export async function verifyCustomerOtp(params: {
  challengeId: string;
  otpCode: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const verifyLimit = checkRateLimit(
    `cust-otp-verify:${params.ipAddress || 'unknown'}`,
    20,
    5 * 60_000
  );
  if (!verifyLimit.allowed) {
    throw new Error(`RATE_LIMITED:${verifyLimit.retryAfterSeconds}`);
  }

  const record = await db.query.identityVerificationRecords.findFirst({
    where: eq(identityVerificationRecords.id, params.challengeId),
  });

  if (!record) {
    throw new Error('OTP_CHALLENGE_NOT_FOUND');
  }
  if (record.verifiedAt) {
    throw new Error('OTP_ALREADY_USED');
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw new Error('OTP_EXPIRED');
  }
  if (record.attemptCount >= record.maxAttempts) {
    throw new Error('OTP_MAX_ATTEMPTS_EXCEEDED');
  }

  const normalizedOtp = normalizeDigits(params.otpCode).replace(/\s+/g, '');
  const candidateHash = hashOtpCode(record.id, normalizedOtp);

  if (!constantTimeEquals(record.otpCodeHash, candidateHash)) {
    const nextCount = record.attemptCount + 1;
    await db
      .update(identityVerificationRecords)
      .set({ attemptCount: nextCount })
      .where(eq(identityVerificationRecords.id, record.id));

    await recordAuditLog({
      actorType: 'anonymous',
      action: 'customer.otp.failed',
      targetType: 'identity_verification',
      targetId: record.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: {
        attemptCount: nextCount,
        maxAttempts: record.maxAttempts,
      },
    });

    if (nextCount >= record.maxAttempts) {
      throw new Error('OTP_MAX_ATTEMPTS_EXCEEDED');
    }
    throw new Error('OTP_INVALID_CODE');
  }

  await db
    .update(identityVerificationRecords)
    .set({ verifiedAt: new Date() })
    .where(eq(identityVerificationRecords.id, record.id));

  const profile = await db.query.customerProfiles.findFirst({
    where: eq(customerProfiles.nationalIdHmac, record.nationalIdHmac),
  });

  if (!profile) {
    throw new Error('CUSTOMER_PROFILE_MISSING');
  }

  // Update verified customer's display name if provided
  if (record.fullNameSnapshot && record.fullNameSnapshot !== profile.fullName) {
    await db
      .update(customerProfiles)
      .set({
        fullName: record.fullNameSnapshot,
        updatedAt: new Date(),
      })
      .where(eq(customerProfiles.id, profile.id));
  }

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashCustomerSessionToken(rawToken);
  const sessionId = `cses_${randomUUID()}`;
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(customerSessions).values({
    id: sessionId,
    customerProfileId: profile.id,
    tokenHash,
    expiresAt: sessionExpiresAt,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  await recordAuditLog({
    actorType: 'anonymous',
    action: 'customer.otp.verified',
    targetType: 'customer_profile',
    targetId: profile.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      purpose: record.purpose,
    },
  });

  return {
    rawSessionToken: rawToken,
    expiresAt: sessionExpiresAt,
    customer: {
      id: profile.id,
      customerRef: `CUST-${profile.id.slice(5, 11).toUpperCase()}`,
      fullName: record.fullNameSnapshot || profile.fullName,
      phoneMasked: profile.phoneMasked,
      createdAt: profile.createdAt.toISOString(),
    },
  };
}

export async function getCustomerByRawSessionToken(
  rawToken: string | null | undefined
): Promise<AuthenticatedCustomer | null> {
  if (!rawToken || rawToken.length < 16) return null;
  const tokenHash = hashCustomerSessionToken(rawToken);

  const rows = await db
    .select({
      sessionId: customerSessions.id,
      customerId: customerProfiles.id,
      fullName: customerProfiles.fullName,
      phoneMasked: customerProfiles.phoneMasked,
      createdAt: customerProfiles.createdAt,
    })
    .from(customerSessions)
    .innerJoin(
      customerProfiles,
      eq(customerSessions.customerProfileId, customerProfiles.id)
    )
    .where(
      and(
        eq(customerSessions.tokenHash, tokenHash),
        gt(customerSessions.expiresAt, new Date())
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    sessionId: row.sessionId,
    customer: {
      id: row.customerId,
      customerRef: `CUST-${row.customerId.slice(5, 11).toUpperCase()}`,
      fullName: row.fullName,
      phoneMasked: row.phoneMasked,
      createdAt: row.createdAt.toISOString(),
    },
  };
}

export async function getAuthenticatedCustomerSession(): Promise<AuthenticatedCustomer | null> {
  try {
    const cookieStore = await cookies();
    const rawToken = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
    return getCustomerByRawSessionToken(rawToken);
  } catch {
    return null;
  }
}

export async function revokeCustomerSessionByToken(rawToken: string | null | undefined) {
  if (!rawToken) return;
  const tokenHash = hashCustomerSessionToken(rawToken);
  await db.delete(customerSessions).where(eq(customerSessions.tokenHash, tokenHash));
}

export async function resolveOrCreateCustomerByIdentity(params: {
  nationalId: string;
  fullName: string;
  phone?: string | null;
}): Promise<{
  id: string;
  customerRef: string;
  fullName: string;
  hasPassword: boolean;
}> {
  const nidResult = validateIranianNationalId(params.nationalId);
  if (!nidResult.valid) {
    throw new Error(`INVALID_NATIONAL_ID:${nidResult.reason}`);
  }

  const nidHmac = computeNationalIdHmac(nidResult.normalized);
  const existing = await db.query.customerProfiles.findFirst({
    where: eq(customerProfiles.nationalIdHmac, nidHmac),
  });

  if (existing) {
    return {
      id: existing.id,
      customerRef: `CUST-${existing.id.replace(/^cust_/, '').slice(0, 6).toUpperCase()}`,
      fullName: existing.fullName,
      hasPassword: Boolean(existing.passwordHash),
    };
  }

  const phoneInfo = normalizeAndValidateIranianMobile(params.phone);
  const cleanName = params.fullName.trim();
  const newProfileId = `cust_${randomUUID()}`;

  await db
    .insert(customerProfiles)
    .values({
      id: newProfileId,
      nationalIdHmac: nidHmac,
      encryptedNationalId: encryptNationalId(nidResult.normalized),
      nationalIdLast4: nidResult.normalized.slice(-4),
      fullName: cleanName,
      encryptedPhone: phoneInfo.encrypted,
      phoneMasked: phoneInfo.masked,
    })
    .onConflictDoNothing({ target: customerProfiles.nationalIdHmac });

  const resolved = await db.query.customerProfiles.findFirst({
    where: eq(customerProfiles.nationalIdHmac, nidHmac),
  });

  if (!resolved) {
    throw new Error('CUSTOMER_PROFILE_MISSING');
  }

  return {
    id: resolved.id,
    customerRef: `CUST-${resolved.id.replace(/^cust_/, '').slice(0, 6).toUpperCase()}`,
    fullName: resolved.fullName,
    hasPassword: Boolean(resolved.passwordHash),
  };
}

export async function authenticateCustomerWithPassword(params: {
  nationalId: string;
  password: string;
  fullName?: string;
  phone?: string | null;
  mode?: 'auto' | 'login' | 'set_password';
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const nidResult = validateIranianNationalId(params.nationalId);
  if (!nidResult.valid) {
    throw new Error(`INVALID_NATIONAL_ID:${nidResult.reason}`);
  }

  const nidHmac = computeNationalIdHmac(nidResult.normalized);
  const ipLimit = checkRateLimit(
    `cust-pwd-ip:${params.ipAddress || 'unknown'}`,
    25,
    5 * 60_000
  );
  if (!ipLimit.allowed) {
    throw new Error(`RATE_LIMITED:${ipLimit.retryAfterSeconds}`);
  }

  const nidLimit = checkRateLimit(`cust-pwd-nid:${nidHmac}`, 10, 5 * 60_000);
  if (!nidLimit.allowed) {
    throw new Error(`RATE_LIMITED:${nidLimit.retryAfterSeconds}`);
  }

  const mode = params.mode ?? 'auto';
  const existing = await db.query.customerProfiles.findFirst({
    where: eq(customerProfiles.nationalIdHmac, nidHmac),
  });

  let profile = existing;
  let isFirstTimeSetup = false;

  if (!profile) {
    if (mode === 'login') {
      throw new Error('CUSTOMER_NEEDS_FIRST_TIME_PASSWORD');
    }
    const cleanName = params.fullName?.trim() || '';
    if (cleanName.length < 2) {
      throw new Error('FIRST_TIME_SETUP_NEEDS_NAME');
    }

    const phoneInfo = normalizeAndValidateIranianMobile(params.phone);
    const pwdHash = await hashPassword(params.password);
    const newId = `cust_${randomUUID()}`;
    const now = new Date();

    await db
      .insert(customerProfiles)
      .values({
        id: newId,
        nationalIdHmac: nidHmac,
        encryptedNationalId: encryptNationalId(nidResult.normalized),
        nationalIdLast4: nidResult.normalized.slice(-4),
        fullName: cleanName,
        encryptedPhone: phoneInfo.encrypted,
        phoneMasked: phoneInfo.masked,
        passwordHash: pwdHash,
        passwordUpdatedAt: now,
      })
      .onConflictDoNothing({ target: customerProfiles.nationalIdHmac });

    profile = await db.query.customerProfiles.findFirst({
      where: eq(customerProfiles.nationalIdHmac, nidHmac),
    });
    if (!profile) {
      throw new Error('CUSTOMER_PROFILE_MISSING');
    }
    isFirstTimeSetup = true;
  } else if (!profile.passwordHash) {
    // Customer previously submitted a ticket/conversation with national ID + name without setting a password yet
    if (mode === 'login') {
      throw new Error('CUSTOMER_NEEDS_FIRST_TIME_PASSWORD');
    }
    const pwdHash = await hashPassword(params.password);
    const now = new Date();
    const phoneInfo = params.phone?.trim()
      ? normalizeAndValidateIranianMobile(params.phone)
      : null;

    await db
      .update(customerProfiles)
      .set({
        passwordHash: pwdHash,
        passwordUpdatedAt: now,
        ...(phoneInfo ? { encryptedPhone: phoneInfo.encrypted, phoneMasked: phoneInfo.masked } : {}),
        updatedAt: now,
      })
      .where(eq(customerProfiles.id, profile.id));

    profile = {
      ...profile,
      passwordHash: pwdHash,
      passwordUpdatedAt: now,
      ...(phoneInfo ? { phoneMasked: phoneInfo.masked } : {}),
    };
    isFirstTimeSetup = true;
  } else {
    // Profile already has a password
    if (mode === 'set_password') {
      throw new Error('PASSWORD_ALREADY_SET');
    }
    const isValid = await verifyPassword({
      hash: profile.passwordHash,
      password: params.password,
    });
    if (!isValid) {
      await recordAuditLog({
        actorType: 'anonymous',
        action: 'customer.auth.password_failed',
        targetType: 'customer_profile',
        targetId: profile.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      throw new Error('INVALID_CUSTOMER_CREDENTIALS');
    }
  }

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashCustomerSessionToken(rawToken);
  const sessionId = `cses_${randomUUID()}`;
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(customerSessions).values({
    id: sessionId,
    customerProfileId: profile.id,
    tokenHash,
    expiresAt: sessionExpiresAt,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  await recordAuditLog({
    actorType: 'anonymous',
    action: isFirstTimeSetup
      ? 'customer.auth.password_initialized'
      : 'customer.auth.password_login',
    targetType: 'customer_profile',
    targetId: profile.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return {
    rawSessionToken: rawToken,
    expiresAt: sessionExpiresAt,
    isFirstTimeSetup,
    customer: {
      id: profile.id,
      customerRef: `CUST-${profile.id.replace(/^cust_/, '').slice(0, 6).toUpperCase()}`,
      fullName: profile.fullName,
      phoneMasked: profile.phoneMasked,
      createdAt: profile.createdAt.toISOString(),
    },
  };
}

