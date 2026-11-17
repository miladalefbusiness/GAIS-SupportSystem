import { desc, eq, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import {
  aiConversations,
  customerProfiles,
  customerSessions,
  identityVerificationRecords,
  ticketAttachments,
  tickets,
} from '@/src/db/schema.ts';
import {
  decryptNationalId,
  normalizeAndValidateIranianMobile,
} from './national-id.ts';

export interface SystemUserAdminDto {
  id: string;
  customerRef: string;
  nationalId: string;
  nationalIdLast4: string;
  fullName: string;
  phoneMasked: string | null;
  hasPassword: boolean;
  passwordUpdatedAt: string | null;
  ticketCount: number;
  conversationCount: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export async function listSystemUsersAdmin(searchQuery?: string): Promise<SystemUserAdminDto[]> {
  const [profiles, ticketAggs, convAggs] = await Promise.all([
    db
      .select()
      .from(customerProfiles)
      .orderBy(desc(customerProfiles.createdAt)),
    db
      .select({
        customerProfileId: tickets.customerProfileId,
        count: sql<number>`count(*)::int`,
        lastAt: sql<Date | null>`max(${tickets.lastMessageAt})`,
      })
      .from(tickets)
      .groupBy(tickets.customerProfileId),
    db
      .select({
        customerProfileId: aiConversations.customerProfileId,
        count: sql<number>`count(*)::int`,
        lastAt: sql<Date | null>`max(${aiConversations.updatedAt})`,
      })
      .from(aiConversations)
      .groupBy(aiConversations.customerProfileId),
  ]);

  const ticketMap = new Map(
    ticketAggs.map((t) => [
      t.customerProfileId,
      { count: Number(t.count ?? 0), lastAt: t.lastAt ? new Date(t.lastAt) : null },
    ])
  );

  const convMap = new Map(
    convAggs
      .filter((c) => Boolean(c.customerProfileId))
      .map((c) => [
        c.customerProfileId as string,
        { count: Number(c.count ?? 0), lastAt: c.lastAt ? new Date(c.lastAt) : null },
      ])
  );

  const items: SystemUserAdminDto[] = profiles.map((p) => {
    let nationalId = `******${p.nationalIdLast4}`;
    try {
      nationalId = decryptNationalId(p.encryptedNationalId);
    } catch {
      // Fallback safely if key rotated
    }

    const tInfo = ticketMap.get(p.id);
    const cInfo = convMap.get(p.id);
    const lastDates = [tInfo?.lastAt, cInfo?.lastAt].filter(
      (d): d is Date => d instanceof Date && !Number.isNaN(d.getTime())
    );
    const lastActivity =
      lastDates.length > 0
        ? new Date(Math.max(...lastDates.map((d) => d.getTime()))).toISOString()
        : null;

    return {
      id: p.id,
      customerRef: `CUST-${p.id.replace(/^cust_/, '').slice(0, 6).toUpperCase()}`,
      nationalId,
      nationalIdLast4: p.nationalIdLast4,
      fullName: p.fullName,
      phoneMasked: p.phoneMasked,
      hasPassword: Boolean(p.passwordHash),
      passwordUpdatedAt: p.passwordUpdatedAt ? p.passwordUpdatedAt.toISOString() : null,
      ticketCount: tInfo?.count ?? 0,
      conversationCount: cInfo?.count ?? 0,
      lastActivityAt: lastActivity,
      createdAt: p.createdAt.toISOString(),
    };
  });

  const q = searchQuery?.trim().toLowerCase();
  if (!q) return items;

  return items.filter(
    (item) =>
      item.fullName.toLowerCase().includes(q) ||
      item.nationalId.toLowerCase().includes(q) ||
      item.customerRef.toLowerCase().includes(q) ||
      (item.phoneMasked?.toLowerCase().includes(q) ?? false)
  );
}

export async function updateSystemUserAdmin(params: {
  targetCustomerId: string;
  input: {
    fullName?: string;
    phone?: string | null;
    newPassword?: string;
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db.query.customerProfiles.findFirst({
    where: eq(customerProfiles.id, params.targetCustomerId),
  });
  if (!existing) return null;

  const updates: Partial<typeof customerProfiles.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (params.input.fullName !== undefined) {
    updates.fullName = params.input.fullName.trim();
  }

  if (params.input.phone !== undefined) {
    if (!params.input.phone || params.input.phone.trim() === '') {
      updates.encryptedPhone = null;
      updates.phoneMasked = null;
    } else {
      const phoneInfo = normalizeAndValidateIranianMobile(params.input.phone);
      updates.encryptedPhone = phoneInfo.encrypted;
      updates.phoneMasked = phoneInfo.masked;
    }
  }

  let passwordChanged = false;
  if (params.input.newPassword && params.input.newPassword.length >= 6) {
    updates.passwordHash = await hashPassword(params.input.newPassword);
    updates.passwordUpdatedAt = new Date();
    passwordChanged = true;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(customerProfiles)
      .set(updates)
      .where(eq(customerProfiles.id, params.targetCustomerId));

    if (passwordChanged) {
      await tx
        .delete(customerSessions)
        .where(eq(customerSessions.customerProfileId, params.targetCustomerId));
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: passwordChanged
      ? 'admin.system_user.password_reset'
      : 'admin.system_user.updated',
    targetType: 'customer_profile',
    targetId: params.targetCustomerId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      fullNameUpdated: params.input.fullName !== undefined,
      phoneUpdated: params.input.phone !== undefined,
      passwordChanged,
    },
  });

  const updatedList = await listSystemUsersAdmin();
  return updatedList.find((u) => u.id === params.targetCustomerId) ?? null;
}

export async function deleteSystemUserAdmin(params: {
  targetCustomerId: string;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db.query.customerProfiles.findFirst({
    where: eq(customerProfiles.id, params.targetCustomerId),
  });
  if (!existing) return null;

  const customerTickets = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.customerProfileId, params.targetCustomerId));

  const storageKeysToDelete: string[] = [];
  for (const t of customerTickets) {
    const atts = await db
      .select({ storageKey: ticketAttachments.storageKey })
      .from(ticketAttachments)
      .where(eq(ticketAttachments.ticketId, t.id));
    for (const a of atts) {
      storageKeysToDelete.push(a.storageKey);
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(customerSessions)
      .where(eq(customerSessions.customerProfileId, params.targetCustomerId));
    await tx
      .delete(identityVerificationRecords)
      .where(eq(identityVerificationRecords.customerProfileId, params.targetCustomerId));
    await tx
      .delete(aiConversations)
      .where(eq(aiConversations.customerProfileId, params.targetCustomerId));
    await tx
      .delete(customerProfiles)
      .where(eq(customerProfiles.id, params.targetCustomerId));
  });

  if (storageKeysToDelete.length > 0) {
    const driver = getStorageDriver();
    await Promise.all(
      storageKeysToDelete.map((key) => driver.delete(key).catch(() => {}))
    );
  }

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'admin.system_user.deleted',
    targetType: 'customer_profile',
    targetId: params.targetCustomerId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      deletedFullName: existing.fullName,
      deletedTicketCount: customerTickets.length,
    },
  });

  return { ok: true, deletedTicketCount: customerTickets.length };
}
