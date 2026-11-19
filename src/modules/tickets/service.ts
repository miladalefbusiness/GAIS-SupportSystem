import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import {
  canAccessDepartment,
  hasPermission,
  type UserAccessProfile,
} from '@/src/core/auth/rbac.ts';
import { listAuthorizedDepartmentsForOperator } from '@/src/modules/departments/service.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import {
  aiConversations,
  aiMessages,
  customerProfiles,
  departmentMemberships,
  departments,
  knowledgeRetrievalRecords,
  notifications,
  operatorAvailability,
  ticketActivity,
  ticketAssignments,
  ticketAttachments,
  ticketMessages,
  ticketStatusHistory,
  tickets,
  users,
} from '@/src/db/schema.ts';
import { allocateReferenceAndAssigneeInTx } from './assignment.ts';
import {
  persistValidatedAttachmentBuffer,
  validateAttachmentUpload,
  type ValidatedAttachmentPayload,
} from './attachments.ts';
import type { TicketPriority, TicketStatus } from './schemas.ts';

export interface UploadedFileInput {
  filename: string;
  buffer: Buffer;
}

export function formatCustomerRef(customerId: string): string {
  return `CUST-${customerId.replace(/^cust_/, '').slice(0, 6).toUpperCase()}`;
}

export interface CustomerTicketSummaryDto {
  id: string;
  referenceCode: string;
  departmentId: string;
  departmentNameFa: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  conversationMode: string;
  hasAssignedOperator: boolean;
  lastMessageAt: string;
  createdAt: string;
}

export interface CustomerTicketDetailDto extends CustomerTicketSummaryDto {
  messages: Array<{
    id: string;
    senderType: 'customer' | 'operator' | 'ai_assistant' | 'system';
    senderLabel: string;
    body: string;
    createdAt: string;
    attachments: Array<{
      id: string;
      originalFilename: string;
      mimeType: string;
      byteSize: number;
    }>;
  }>;
  attachments: Array<{
    id: string;
    messageId: string | null;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    createdAt: string;
  }>;
}

async function prepareValidatedAttachments(
  files: UploadedFileInput[],
  maxUploadSizeMb: number
): Promise<ValidatedAttachmentPayload[]> {
  if (files.length === 0) return [];
  if (files.length > 5) {
    throw new Error('TOO_MANY_ATTACHMENTS');
  }
  const validated: ValidatedAttachmentPayload[] = [];
  for (const f of files) {
    validated.push(
      await validateAttachmentUpload({
        filename: f.filename,
        buffer: f.buffer,
        maxUploadSizeMb,
      })
    );
  }
  return validated;
}

async function storeAttachmentPayloads(
  validated: ValidatedAttachmentPayload[]
): Promise<Array<{ payload: ValidatedAttachmentPayload; storageKey: string }>> {
  const stored: Array<{ payload: ValidatedAttachmentPayload; storageKey: string }> = [];
  try {
    for (const item of validated) {
      const storageKey = await persistValidatedAttachmentBuffer(item);
      stored.push({ payload: item, storageKey });
    }
    return stored;
  } catch (err) {
    const driver = getStorageDriver();
    await Promise.all(stored.map((s) => driver.delete(s.storageKey).catch(() => {})));
    throw err;
  }
}

export async function createCustomerTicket(params: {
  customerId: string;
  customerName: string;
  departmentId: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  files?: UploadedFileInput[];
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, params.departmentId),
  });

  if (!dept || !dept.isActive || !dept.isPublic) {
    throw new Error('DEPARTMENT_NOT_AVAILABLE');
  }

  const validatedFiles = await prepareValidatedAttachments(
    params.files ?? [],
    dept.maxUploadSizeMb
  );
  const storedFiles = await storeAttachmentPayloads(validatedFiles);

  try {
    const created = await db.transaction(async (tx) => {
      const decision = await allocateReferenceAndAssigneeInTx(tx, {
        id: dept.id,
        slug: dept.slug,
        assignmentStrategy: dept.assignmentStrategy,
      });

      const ticketId = `tkt_${randomUUID()}`;
      const messageId = `tmsg_${randomUUID()}`;
      const now = new Date();
      const initialStatus: TicketStatus = decision.assignedOperator
        ? 'assigned'
        : 'waiting_for_operator';
      const initialMode = decision.assignedOperator
        ? 'assigned_to_operator'
        : 'waiting_for_operator';

      const [ticket] = await tx
        .insert(tickets)
        .values({
          id: ticketId,
          referenceCode: decision.referenceCode,
          customerProfileId: params.customerId,
          departmentId: dept.id,
          assignedOperatorId: decision.assignedOperator?.userId ?? null,
          subject: params.subject.trim(),
          status: initialStatus,
          priority: params.priority,
          conversationMode: initialMode,
          aiAutoReplyEnabled: false,
          lastMessageAt: now,
        })
        .returning();

      await tx.insert(ticketMessages).values({
        id: messageId,
        ticketId,
        senderType: 'customer',
        senderCustomerId: params.customerId,
        visibility: 'public',
        body: params.description.trim(),
        createdAt: now,
      });

      for (const s of storedFiles) {
        await tx.insert(ticketAttachments).values({
          id: `tatt_${randomUUID()}`,
          ticketId,
          messageId,
          uploadedByType: 'customer',
          originalFilename: s.payload.originalFilename,
          storageKey: s.storageKey,
          mimeType: s.payload.mimeType,
          fileExtension: s.payload.extension,
          byteSize: s.payload.byteSize,
          sha256: s.payload.sha256,
          scanStatus: s.payload.scanStatus,
        });
      }

      await tx.insert(ticketAssignments).values({
        id: `tass_${randomUUID()}`,
        ticketId,
        toDepartmentId: dept.id,
        toOperatorId: decision.assignedOperator?.userId ?? null,
        strategyUsed: decision.strategyUsed,
        reason: decision.assignedOperator
          ? 'تخصیص خودکار هنگام ثبت تیکت'
          : 'در انتظار تخصیص اپراتور دپارتمان',
      });

      await tx.insert(ticketStatusHistory).values({
        id: `tsh_${randomUUID()}`,
        ticketId,
        fromStatus: null,
        toStatus: initialStatus,
        changedByType: 'customer',
      });

      await tx.insert(ticketActivity).values({
        id: `tact_${randomUUID()}`,
        ticketId,
        activityType: 'ticket_created',
        actorLabel: params.customerName,
        detailsJson: {
          departmentId: dept.id,
          strategyUsed: decision.strategyUsed,
          assignedOperatorId: decision.assignedOperator?.userId ?? null,
          attachmentCount: storedFiles.length,
        },
      });

      if (decision.assignedOperator) {
        await tx.insert(notifications).values({
          id: `ntf_${randomUUID()}`,
          recipientUserId: decision.assignedOperator.userId,
          ticketId,
          type: 'ticket_assigned',
          titleFa: `تیکت جدید ${decision.referenceCode}`,
          bodyFa: `تیکت «${ticket.subject}» در دپارتمان ${dept.nameFa} به شما تخصیص داده شد.`,
        });
      } else {
        const managers = await tx
          .select({ userId: departmentMemberships.userId })
          .from(departmentMemberships)
          .where(
            and(
              eq(departmentMemberships.departmentId, dept.id),
              eq(departmentMemberships.isManager, true)
            )
          );
        for (const mgr of managers) {
          await tx.insert(notifications).values({
            id: `ntf_${randomUUID()}`,
            recipientUserId: mgr.userId,
            ticketId,
            type: 'ticket_unassigned',
            titleFa: `تیکت جدید در صف دپارتمان (${decision.referenceCode})`,
            bodyFa: `تیکت «${ticket.subject}» منتظر تخصیص اپراتور در ${dept.nameFa} است.`,
          });
        }
      }

      return ticket;
    });

    await recordAuditLog({
      actorType: 'anonymous',
      action: 'ticket.created',
      targetType: 'ticket',
      targetId: created.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: {
        referenceCode: created.referenceCode,
        departmentId: created.departmentId,
        customerProfileId: params.customerId,
        assignedOperatorId: created.assignedOperatorId,
      },
    });

    return getCustomerTicketDetail(params.customerId, created.id);
  } catch (err) {
    const driver = getStorageDriver();
    await Promise.all(storedFiles.map((s) => driver.delete(s.storageKey).catch(() => {})));
    throw err;
  }
}

export async function convertAiConversationToTicket(params: {
  customerId: string;
  customerName: string;
  aiConversationId: string;
  subject?: string;
  priority?: TicketPriority;
  reason?: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existingTicket = await db.query.tickets.findFirst({
    where: eq(tickets.linkedAiConversationId, params.aiConversationId),
  });

  if (existingTicket) {
    if (existingTicket.customerProfileId !== params.customerId) {
      throw new Error('CONVERSATION_OWNERSHIP_MISMATCH');
    }
    const detail = await getCustomerTicketDetail(params.customerId, existingTicket.id);
    return { ticket: detail!, alreadyConverted: true };
  }

  const conv = await db.query.aiConversations.findFirst({
    where: eq(aiConversations.id, params.aiConversationId),
  });
  if (!conv) {
    throw new Error('CONVERSATION_NOT_FOUND');
  }

  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, conv.departmentId),
  });
  if (!dept || !dept.isActive) {
    throw new Error('DEPARTMENT_NOT_AVAILABLE');
  }

  const aiMsgs = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conv.id))
    .orderBy(asc(aiMessages.createdAt));

  const firstCustomerMsg = aiMsgs.find((m) => m.senderRole === 'customer')?.content || '';
  const derivedSubject =
    params.subject?.trim() ||
    (firstCustomerMsg
      ? `${firstCustomerMsg.slice(0, 72)}${firstCustomerMsg.length > 72 ? '...' : ''}`
      : `ارجاع گفت‌وگوی هوشمند (${dept.nameFa})`);

  const created = await db.transaction(async (tx) => {
    const decision = await allocateReferenceAndAssigneeInTx(tx, {
      id: dept.id,
      slug: dept.slug,
      assignmentStrategy: dept.assignmentStrategy,
    });

    const ticketId = `tkt_${randomUUID()}`;
    const now = new Date();
    const initialStatus: TicketStatus = decision.assignedOperator
      ? 'assigned'
      : 'waiting_for_operator';
    const initialMode = decision.assignedOperator
      ? 'assigned_to_operator'
      : 'waiting_for_operator';

    const [ticket] = await tx
      .insert(tickets)
      .values({
        id: ticketId,
        referenceCode: decision.referenceCode,
        customerProfileId: params.customerId,
        departmentId: dept.id,
        assignedOperatorId: decision.assignedOperator?.userId ?? null,
        linkedAiConversationId: conv.id,
        subject: derivedSubject,
        status: initialStatus,
        priority: params.priority ?? 'normal',
        conversationMode: initialMode,
        aiAutoReplyEnabled: false,
        lastMessageAt: now,
      })
      .returning();

    // Update AI conversation state to permanently stop AI auto-reply unless operator re-enables
    await tx
      .update(aiConversations)
      .set({
        escalatedToHuman: true,
        aiAutoReplyEnabled: false,
        mode: initialMode,
        handoffRequestedAt: conv.handoffRequestedAt ?? now,
        handoffReason: params.reason || conv.handoffReason || 'ارجاع گفت‌وگوی هوشمند به تیکت',
        updatedAt: now,
      })
      .where(eq(aiConversations.id, conv.id));

    // Preserve every AI conversation turn chronologically in the ticket timeline
    for (const msg of aiMsgs) {
      const mappedSender: 'customer' | 'ai_assistant' | 'system' =
        msg.senderRole === 'customer'
          ? 'customer'
          : msg.senderRole === 'ai_assistant'
          ? 'ai_assistant'
          : 'system';

      await tx.insert(ticketMessages).values({
        id: `tmsg_${randomUUID()}`,
        ticketId,
        senderType: mappedSender,
        senderCustomerId: mappedSender === 'customer' ? params.customerId : null,
        visibility: 'public',
        body: msg.content,
        createdAt: msg.createdAt,
      });
    }

    const retrievalRecords = await tx
      .select()
      .from(knowledgeRetrievalRecords)
      .where(eq(knowledgeRetrievalRecords.conversationId, conv.id))
      .orderBy(asc(knowledgeRetrievalRecords.createdAt));

    if (retrievalRecords.length > 0) {
      const latestRec = retrievalRecords[retrievalRecords.length - 1];
      const traceObj = (latestRec.traceJson || {}) as Record<string, unknown>;
      const sourceLines = (latestRec.sourcesJson || [])
        .slice(0, 4)
        .map(
          (s) =>
            `• ${s.title}${s.documentVersion ? ` (نسخه ${s.documentVersion})` : ''}${
              s.pageNumber ? ` صفحه ${s.pageNumber}` : ''
            } [امتیاز: ${s.score}]`
        );
      const summaryLines = [
        'گزارش خودکار موتور بازیابی دانش (RAG / CRAG) برای کارشناس:',
        `وضعیت آخرین ارزیابی: ${String(traceObj.cragDecision || (latestRec.abstained ? 'abstained' : 'relevant'))} · بالاترین امتیاز: ${latestRec.topScore}`,
        traceObj.cragReasonFa ? `دلیل ارزیابی: ${String(traceObj.cragReasonFa)}` : null,
        sourceLines.length > 0 ? `منابع بررسی‌شده:\n${sourceLines.join('\n')}` : 'منبع مستقیمی یافت نشد.',
      ]
        .filter(Boolean)
        .join('\n');

      await tx.insert(ticketMessages).values({
        id: `tmsg_${randomUUID()}`,
        ticketId,
        senderType: 'system',
        visibility: 'internal_note',
        body: summaryLines,
        createdAt: now,
      });
    }

    await tx.insert(ticketMessages).values({
      id: `tmsg_${randomUUID()}`,
      ticketId,
      senderType: 'system',
      visibility: 'public',
      body: decision.assignedOperator
        ? `این گفت‌وگو با حفظ تاریخچه کامل به تیکت شماره ${decision.referenceCode} تبدیل و به کارشناس دپارتمان ${dept.nameFa} ارجاع داده شد.`
        : `این گفت‌وگو با حفظ تاریخچه کامل به تیکت شماره ${decision.referenceCode} تبدیل شد و در صف انتظار کارشناسان ${dept.nameFa} قرار گرفت.`,
      createdAt: now,
    });

    await tx.insert(ticketAssignments).values({
      id: `tass_${randomUUID()}`,
      ticketId,
      toDepartmentId: dept.id,
      toOperatorId: decision.assignedOperator?.userId ?? null,
      strategyUsed: decision.strategyUsed,
      reason: params.reason || 'تبدیل گفت‌وگوی دستیار هوشمند به تیکت پشتیبانی',
    });

    await tx.insert(ticketStatusHistory).values({
      id: `tsh_${randomUUID()}`,
      ticketId,
      fromStatus: null,
      toStatus: initialStatus,
      changedByType: 'customer',
    });

    await tx.insert(ticketActivity).values({
      id: `tact_${randomUUID()}`,
      ticketId,
      activityType: 'ai_handoff_converted',
      actorLabel: params.customerName,
      detailsJson: {
        aiConversationId: conv.id,
        preservedMessageCount: aiMsgs.length,
        assignedOperatorId: decision.assignedOperator?.userId ?? null,
      },
    });

    if (decision.assignedOperator) {
      await tx.insert(notifications).values({
        id: `ntf_${randomUUID()}`,
        recipientUserId: decision.assignedOperator.userId,
        ticketId,
        type: 'ai_escalated',
        titleFa: `ارجاع گفت‌وگوی هوشمند (${decision.referenceCode})`,
        bodyFa: `مشتری «${params.customerName}» گفت‌وگو را با تاریخچه کامل به دپارتمان ${dept.nameFa} ارجاع داد.`,
      });
    }

    return ticket;
  });

  await recordAuditLog({
    actorType: 'anonymous',
    action: 'ticket.created_from_ai_handoff',
    targetType: 'ticket',
    targetId: created.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      aiConversationId: conv.id,
      referenceCode: created.referenceCode,
      departmentId: created.departmentId,
    },
  });

  const detail = await getCustomerTicketDetail(params.customerId, created.id);
  return { ticket: detail!, alreadyConverted: false };
}

export async function listCustomerTickets(
  customerId: string
): Promise<CustomerTicketSummaryDto[]> {
  const rows = await db
    .select({
      id: tickets.id,
      referenceCode: tickets.referenceCode,
      departmentId: tickets.departmentId,
      departmentNameFa: departments.nameFa,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      conversationMode: tickets.conversationMode,
      assignedOperatorId: tickets.assignedOperatorId,
      lastMessageAt: tickets.lastMessageAt,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .innerJoin(departments, eq(tickets.departmentId, departments.id))
    .where(eq(tickets.customerProfileId, customerId))
    .orderBy(desc(tickets.lastMessageAt));

  return rows.map((r) => ({
    id: r.id,
    referenceCode: r.referenceCode,
    departmentId: r.departmentId,
    departmentNameFa: r.departmentNameFa,
    subject: r.subject,
    status: r.status as TicketStatus,
    priority: r.priority as TicketPriority,
    conversationMode: r.conversationMode,
    hasAssignedOperator: Boolean(r.assignedOperatorId),
    lastMessageAt: r.lastMessageAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Customer-safe ticket detail.
 * CRITICAL SECURITY BOUNDARY:
 * - Verifies ticket ownership (`customerProfileId === customerId`)
 * - Strictly filters messages by `visibility = 'public'` (NEVER returns internal_note)
 * - NEVER returns raw National ID, operator emails/usernames, or internal KB metadata
 */
export async function getCustomerTicketDetail(
  customerId: string,
  ticketId: string
): Promise<CustomerTicketDetailDto | null> {
  const ticketRows = await db
    .select({
      id: tickets.id,
      referenceCode: tickets.referenceCode,
      customerProfileId: tickets.customerProfileId,
      departmentId: tickets.departmentId,
      departmentNameFa: departments.nameFa,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      conversationMode: tickets.conversationMode,
      assignedOperatorId: tickets.assignedOperatorId,
      lastMessageAt: tickets.lastMessageAt,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .innerJoin(departments, eq(tickets.departmentId, departments.id))
    .where(and(eq(tickets.id, ticketId), eq(tickets.customerProfileId, customerId)))
    .limit(1);

  const ticket = ticketRows[0];
  if (!ticket) return null;

  const [publicMsgs, atts] = await Promise.all([
    db
      .select({
        id: ticketMessages.id,
        senderType: ticketMessages.senderType,
        body: ticketMessages.body,
        createdAt: ticketMessages.createdAt,
        operatorName: users.name,
      })
      .from(ticketMessages)
      .leftJoin(users, eq(ticketMessages.senderUserId, users.id))
      .where(
        and(
          eq(ticketMessages.ticketId, ticket.id),
          eq(ticketMessages.visibility, 'public')
        )
      )
      .orderBy(asc(ticketMessages.createdAt)),
    db
      .select({
        id: ticketAttachments.id,
        messageId: ticketAttachments.messageId,
        originalFilename: ticketAttachments.originalFilename,
        mimeType: ticketAttachments.mimeType,
        byteSize: ticketAttachments.byteSize,
        createdAt: ticketAttachments.createdAt,
      })
      .from(ticketAttachments)
      .where(eq(ticketAttachments.ticketId, ticket.id))
      .orderBy(asc(ticketAttachments.createdAt)),
  ]);

  const attByMsg = new Map<string, Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
  }>>();
  for (const a of atts) {
    if (a.messageId) {
      const list = attByMsg.get(a.messageId) || [];
      list.push({
        id: a.id,
        originalFilename: a.originalFilename,
        mimeType: a.mimeType,
        byteSize: a.byteSize,
      });
      attByMsg.set(a.messageId, list);
    }
  }

  return {
    id: ticket.id,
    referenceCode: ticket.referenceCode,
    departmentId: ticket.departmentId,
    departmentNameFa: ticket.departmentNameFa,
    subject: ticket.subject,
    status: ticket.status as TicketStatus,
    priority: ticket.priority as TicketPriority,
    conversationMode: ticket.conversationMode,
    hasAssignedOperator: Boolean(ticket.assignedOperatorId),
    lastMessageAt: ticket.lastMessageAt.toISOString(),
    createdAt: ticket.createdAt.toISOString(),
    messages: publicMsgs.map((m) => {
      const senderType =
        m.senderType === 'customer' ||
        m.senderType === 'operator' ||
        m.senderType === 'ai_assistant' ||
        m.senderType === 'system'
          ? m.senderType
          : 'system';
      const senderLabel =
        senderType === 'customer'
          ? 'شما'
          : senderType === 'operator'
          ? m.operatorName || 'کارشناس پشتیبانی'
          : senderType === 'ai_assistant'
          ? 'دستیار هوشمند'
          : 'پیام سامانه';
      return {
        id: m.id,
        senderType,
        senderLabel,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        attachments: attByMsg.get(m.id) || [],
      };
    }),
    attachments: atts.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function addCustomerTicketMessage(params: {
  customerId: string;
  customerName: string;
  ticketId: string;
  body: string;
  files?: UploadedFileInput[];
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db
    .select({
      ticket: tickets,
      maxUploadSizeMb: departments.maxUploadSizeMb,
      deptNameFa: departments.nameFa,
    })
    .from(tickets)
    .innerJoin(departments, eq(tickets.departmentId, departments.id))
    .where(and(eq(tickets.id, params.ticketId), eq(tickets.customerProfileId, params.customerId)))
    .limit(1);

  const row = existing[0];
  if (!row) return null;
  if (row.ticket.status === 'closed') {
    throw new Error('TICKET_CLOSED');
  }

  const validatedFiles = await prepareValidatedAttachments(
    params.files ?? [],
    row.maxUploadSizeMb
  );
  const storedFiles = await storeAttachmentPayloads(validatedFiles);

  try {
    const now = new Date();
    const messageId = `tmsg_${randomUUID()}`;
    const nextStatus: TicketStatus =
      row.ticket.status === 'waiting_for_customer' || row.ticket.status === 'resolved'
        ? row.ticket.assignedOperatorId
          ? 'in_progress'
          : 'waiting_for_operator'
        : (row.ticket.status as TicketStatus);

    await db.transaction(async (tx) => {
      await tx.insert(ticketMessages).values({
        id: messageId,
        ticketId: row.ticket.id,
        senderType: 'customer',
        senderCustomerId: params.customerId,
        visibility: 'public',
        body: params.body.trim(),
        createdAt: now,
      });

      for (const s of storedFiles) {
        await tx.insert(ticketAttachments).values({
          id: `tatt_${randomUUID()}`,
          ticketId: row.ticket.id,
          messageId,
          uploadedByType: 'customer',
          originalFilename: s.payload.originalFilename,
          storageKey: s.storageKey,
          mimeType: s.payload.mimeType,
          fileExtension: s.payload.extension,
          byteSize: s.payload.byteSize,
          sha256: s.payload.sha256,
          scanStatus: s.payload.scanStatus,
        });
      }

      await tx
        .update(tickets)
        .set({
          status: nextStatus,
          lastMessageAt: now,
          updatedAt: now,
        })
        .where(eq(tickets.id, row.ticket.id));

      if (nextStatus !== row.ticket.status) {
        await tx.insert(ticketStatusHistory).values({
          id: `tsh_${randomUUID()}`,
          ticketId: row.ticket.id,
          fromStatus: row.ticket.status,
          toStatus: nextStatus,
          changedByType: 'customer',
        });
      }

      if (row.ticket.assignedOperatorId) {
        await tx.insert(notifications).values({
          id: `ntf_${randomUUID()}`,
          recipientUserId: row.ticket.assignedOperatorId,
          ticketId: row.ticket.id,
          type: 'ticket_customer_reply',
          titleFa: `پاسخ جدید مشتری در ${row.ticket.referenceCode}`,
          bodyFa: `${params.customerName} پیام جدیدی در تیکت «${row.ticket.subject}» ارسال کرد.`,
        });
      }
    });

    await recordAuditLog({
      actorType: 'anonymous',
      action: 'ticket.customer_replied',
      targetType: 'ticket',
      targetId: row.ticket.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: {
        messageId,
        attachmentCount: storedFiles.length,
      },
    });

    return getCustomerTicketDetail(params.customerId, row.ticket.id);
  } catch (err) {
    const driver = getStorageDriver();
    await Promise.all(storedFiles.map((s) => driver.delete(s.storageKey).catch(() => {})));
    throw err;
  }
}

export async function getCustomerAttachmentForDownload(
  customerId: string,
  ticketId: string,
  attachmentId: string
) {
  const rows = await db
    .select({
      attachment: ticketAttachments,
    })
    .from(ticketAttachments)
    .innerJoin(tickets, eq(ticketAttachments.ticketId, tickets.id))
    .where(
      and(
        eq(ticketAttachments.id, attachmentId),
        eq(ticketAttachments.ticketId, ticketId),
        eq(tickets.customerProfileId, customerId)
      )
    )
    .limit(1);

  return rows[0]?.attachment ?? null;
}

// ============================================================================
// Operator Workspace Ticketing Service (Strict Department Boundary Enforcement)
// ============================================================================

export async function listOperatorTickets(
  access: UserAccessProfile,
  filters: {
    tab?: 'mine' | 'department' | 'unassigned';
    departmentId?: string;
    status?: string;
    priority?: string;
    q?: string;
    sort?: 'newest' | 'oldest' | 'priority';
    page?: number;
    pageSize?: number;
  }
) {
  const viewAll =
    access.isSuperAdmin || hasPermission(access, 'desk:tickets:view_all');
  const authorizedDeptIds = access.departments.map((d) => d.departmentId);

  if (filters.departmentId && !canAccessDepartment(access, filters.departmentId)) {
    throw new Error('DEPARTMENT_ACCESS_DENIED');
  }

  if (!viewAll && authorizedDeptIds.length === 0) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      counts: { mine: 0, department: 0, unassigned: 0 },
    };
  }

  const conditions = [];

  if (filters.departmentId) {
    conditions.push(eq(tickets.departmentId, filters.departmentId));
  } else if (!viewAll) {
    conditions.push(inArray(tickets.departmentId, authorizedDeptIds));
  }

  const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;

  // Compute summary tab counts for this scope
  const countRows = await db
    .select({
      assignedOperatorId: tickets.assignedOperatorId,
      status: tickets.status,
    })
    .from(tickets)
    .where(baseWhere);

  const actorUserId = access.userId || null;
  let mineCount = 0;
  let unassignedCount = 0;
  for (const r of countRows) {
    if (actorUserId && r.assignedOperatorId === actorUserId) mineCount += 1;
    if (!r.assignedOperatorId && r.status !== 'closed' && r.status !== 'resolved') {
      unassignedCount += 1;
    }
  }

  const filteredConditions = [...conditions];
  if (filters.tab === 'mine') {
    if (actorUserId) {
      filteredConditions.push(eq(tickets.assignedOperatorId, actorUserId));
    }
  } else if (filters.tab === 'unassigned') {
    filteredConditions.push(isNull(tickets.assignedOperatorId));
  }

  if (filters.status && filters.status !== 'all') {
    filteredConditions.push(eq(tickets.status, filters.status));
  }
  if (filters.priority && filters.priority !== 'all') {
    filteredConditions.push(eq(tickets.priority, filters.priority));
  }

  if (filters.q && filters.q.trim().length > 0) {
    const qPattern = `%${filters.q.trim()}%`;
    filteredConditions.push(
      or(
        sql`${tickets.referenceCode} ILIKE ${qPattern}`,
        sql`${tickets.subject} ILIKE ${qPattern}`,
        sql`${customerProfiles.fullName} ILIKE ${qPattern}`
      )!
    );
  }

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, filters.pageSize ?? 20));
  const whereClause = filteredConditions.length > 0 ? and(...filteredConditions) : undefined;

  const orderClause =
    filters.sort === 'oldest'
      ? asc(tickets.lastMessageAt)
      : filters.sort === 'priority'
      ? sql`CASE ${tickets.priority} WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END ASC, ${tickets.lastMessageAt} DESC`
      : desc(tickets.lastMessageAt);

  const [totalResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .innerJoin(customerProfiles, eq(tickets.customerProfileId, customerProfiles.id))
      .where(whereClause),
    db
      .select({
        id: tickets.id,
        referenceCode: tickets.referenceCode,
        subject: tickets.subject,
        status: tickets.status,
        priority: tickets.priority,
        conversationMode: tickets.conversationMode,
        aiAutoReplyEnabled: tickets.aiAutoReplyEnabled,
        departmentId: tickets.departmentId,
        departmentNameFa: departments.nameFa,
        assignedOperatorId: tickets.assignedOperatorId,
        assignedOperatorName: users.name,
        customerProfileId: customerProfiles.id,
        customerName: customerProfiles.fullName,
        linkedAiConversationId: tickets.linkedAiConversationId,
        lastMessageAt: tickets.lastMessageAt,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .innerJoin(departments, eq(tickets.departmentId, departments.id))
      .innerJoin(customerProfiles, eq(tickets.customerProfileId, customerProfiles.id))
      .leftJoin(users, eq(tickets.assignedOperatorId, users.id))
      .where(whereClause)
      .orderBy(orderClause)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      referenceCode: r.referenceCode,
      subject: r.subject,
      status: r.status as TicketStatus,
      priority: r.priority as TicketPriority,
      conversationMode: r.conversationMode,
      aiAutoReplyEnabled: r.aiAutoReplyEnabled,
      departmentId: r.departmentId,
      departmentNameFa: r.departmentNameFa,
      assignedOperatorId: r.assignedOperatorId,
      assignedOperatorName: r.assignedOperatorName,
      customerRef: formatCustomerRef(r.customerProfileId),
      customerName: r.customerName,
      hasAiOrigin: Boolean(r.linkedAiConversationId),
      lastMessageAt: r.lastMessageAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
    total: Number(totalResult[0]?.count ?? 0),
    page,
    pageSize,
    counts: {
      mine: mineCount,
      department: countRows.length,
      unassigned: unassignedCount,
    },
  };
}

export async function getOperatorTicketDetail(
  access: UserAccessProfile,
  ticketId: string
) {
  const rows = await db
    .select({
      ticket: tickets,
      departmentNameFa: departments.nameFa,
      departmentMaxUploadMb: departments.maxUploadSizeMb,
      assignedOperatorName: users.name,
      customerId: customerProfiles.id,
      customerName: customerProfiles.fullName,
      customerPhoneMasked: customerProfiles.phoneMasked,
    })
    .from(tickets)
    .innerJoin(departments, eq(tickets.departmentId, departments.id))
    .innerJoin(customerProfiles, eq(tickets.customerProfileId, customerProfiles.id))
    .leftJoin(users, eq(tickets.assignedOperatorId, users.id))
    .where(eq(tickets.id, ticketId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (!canAccessDepartment(access, row.ticket.departmentId)) {
    throw new Error('DEPARTMENT_ACCESS_DENIED');
  }

  const viewAll = hasPermission(access, 'desk:tickets:view_all');

  const authorizedDeptIds = access.departments.map((d) => d.departmentId);

  const [
    msgs,
    atts,
    assignments,
    statusHistoryRows,
    activityRows,
    deptOperators,
    allDepts,
    customerRecentTickets,
    aiRetrievalRows,
    customerTicketThreadRows,
    customerAiThreadRows,
  ] = await Promise.all([
    db
      .select({
        id: ticketMessages.id,
        senderType: ticketMessages.senderType,
        senderUserId: ticketMessages.senderUserId,
        senderOperatorName: users.name,
        visibility: ticketMessages.visibility,
        body: ticketMessages.body,
        createdAt: ticketMessages.createdAt,
      })
      .from(ticketMessages)
      .leftJoin(users, eq(ticketMessages.senderUserId, users.id))
      .where(eq(ticketMessages.ticketId, ticketId))
      .orderBy(asc(ticketMessages.createdAt)),
    db
      .select()
      .from(ticketAttachments)
      .where(eq(ticketAttachments.ticketId, ticketId))
      .orderBy(asc(ticketAttachments.createdAt)),
    db
      .select({
        id: ticketAssignments.id,
        fromDepartmentId: ticketAssignments.fromDepartmentId,
        toDepartmentId: ticketAssignments.toDepartmentId,
        fromOperatorId: ticketAssignments.fromOperatorId,
        toOperatorId: ticketAssignments.toOperatorId,
        strategyUsed: ticketAssignments.strategyUsed,
        reason: ticketAssignments.reason,
        createdAt: ticketAssignments.createdAt,
      })
      .from(ticketAssignments)
      .where(eq(ticketAssignments.ticketId, ticketId))
      .orderBy(desc(ticketAssignments.createdAt)),
    db
      .select({
        id: ticketStatusHistory.id,
        fromStatus: ticketStatusHistory.fromStatus,
        toStatus: ticketStatusHistory.toStatus,
        changedByType: ticketStatusHistory.changedByType,
        changedByName: users.name,
        createdAt: ticketStatusHistory.createdAt,
      })
      .from(ticketStatusHistory)
      .leftJoin(users, eq(ticketStatusHistory.changedByUserId, users.id))
      .where(eq(ticketStatusHistory.ticketId, ticketId))
      .orderBy(desc(ticketStatusHistory.createdAt)),
    db
      .select()
      .from(ticketActivity)
      .where(eq(ticketActivity.ticketId, ticketId))
      .orderBy(desc(ticketActivity.createdAt))
      .limit(30),
    db
      .select({
        userId: users.id,
        name: users.name,
        userStatus: users.status,
        membershipAvailable: departmentMemberships.isAvailable,
        globalAvailable: operatorAvailability.isAvailable,
      })
      .from(departmentMemberships)
      .innerJoin(users, eq(departmentMemberships.userId, users.id))
      .leftJoin(operatorAvailability, eq(users.id, operatorAvailability.userId))
      .where(eq(departmentMemberships.departmentId, row.ticket.departmentId))
      .orderBy(asc(users.name)),
    db
      .select({
        id: departments.id,
        nameFa: departments.nameFa,
      })
      .from(departments)
      .where(eq(departments.isActive, true))
      .orderBy(asc(departments.displayOrder), asc(departments.nameFa)),
    db
      .select({
        id: tickets.id,
        referenceCode: tickets.referenceCode,
        subject: tickets.subject,
        status: tickets.status,
        departmentId: tickets.departmentId,
        departmentNameFa: departments.nameFa,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .innerJoin(departments, eq(tickets.departmentId, departments.id))
      .where(
        and(
          eq(tickets.customerProfileId, row.customerId),
          viewAll || access.isSuperAdmin || authorizedDeptIds.length === 0
            ? undefined
            : inArray(tickets.departmentId, authorizedDeptIds)
        )
      )
      .orderBy(desc(tickets.createdAt))
      .limit(10),
    row.ticket.linkedAiConversationId
      ? db
          .select()
          .from(knowledgeRetrievalRecords)
          .where(
            eq(
              knowledgeRetrievalRecords.conversationId,
              row.ticket.linkedAiConversationId
            )
          )
          .orderBy(asc(knowledgeRetrievalRecords.createdAt))
      : Promise.resolve([]),
    db
      .select({
        id: ticketMessages.id,
        ticketId: tickets.id,
        referenceCode: tickets.referenceCode,
        subject: tickets.subject,
        departmentNameFa: departments.nameFa,
        senderType: ticketMessages.senderType,
        visibility: ticketMessages.visibility,
        body: ticketMessages.body,
        createdAt: ticketMessages.createdAt,
      })
      .from(ticketMessages)
      .innerJoin(tickets, eq(ticketMessages.ticketId, tickets.id))
      .innerJoin(departments, eq(tickets.departmentId, departments.id))
      .where(
        and(
          eq(tickets.customerProfileId, row.customerId),
          sql`${tickets.id} <> ${ticketId}`,
          eq(ticketMessages.visibility, 'public'),
          viewAll || access.isSuperAdmin || authorizedDeptIds.length === 0
            ? undefined
            : inArray(tickets.departmentId, authorizedDeptIds)
        )
      )
      .orderBy(desc(ticketMessages.createdAt))
      .limit(20),
    db
      .select({
        id: aiMessages.id,
        conversationId: aiConversations.id,
        departmentNameFa: departments.nameFa,
        senderRole: aiMessages.senderRole,
        content: aiMessages.content,
        createdAt: aiMessages.createdAt,
      })
      .from(aiMessages)
      .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
      .innerJoin(departments, eq(aiConversations.departmentId, departments.id))
      .where(
        and(
          eq(aiConversations.customerProfileId, row.customerId),
          row.ticket.linkedAiConversationId
            ? sql`${aiConversations.id} <> ${row.ticket.linkedAiConversationId}`
            : undefined,
          viewAll || access.isSuperAdmin || authorizedDeptIds.length === 0
            ? undefined
            : inArray(aiConversations.departmentId, authorizedDeptIds)
        )
      )
      .orderBy(desc(aiMessages.createdAt))
      .limit(16),
  ]);

  const attByMsg = new Map<string, Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    scanStatus: string;
  }>>();
  for (const a of atts) {
    if (a.messageId) {
      const list = attByMsg.get(a.messageId) || [];
      list.push({
        id: a.id,
        originalFilename: a.originalFilename,
        mimeType: a.mimeType,
        byteSize: a.byteSize,
        scanStatus: a.scanStatus,
      });
      attByMsg.set(a.messageId, list);
    }
  }

  const combinedThreadHistory = [
    ...customerTicketThreadRows.map((m) => ({
      id: m.id,
      sourceType: 'ticket' as const,
      ticketId: m.ticketId as string | null,
      referenceCode: m.referenceCode as string | null,
      title: m.subject,
      departmentNameFa: m.departmentNameFa,
      senderRole: m.senderType,
      body: m.body,
      createdAt: m.createdAt,
    })),
    ...customerAiThreadRows.map((m) => ({
      id: m.id,
      sourceType: 'ai_conversation' as const,
      ticketId: null as string | null,
      referenceCode: null as string | null,
      title: 'گفت‌وگوی قبلی دستیار هوشمند',
      departmentNameFa: m.departmentNameFa,
      senderRole: m.senderRole,
      body: m.content,
      createdAt: m.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20)
    .map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    }));

  return {
    ticket: {
      id: row.ticket.id,
      referenceCode: row.ticket.referenceCode,
      subject: row.ticket.subject,
      status: row.ticket.status as TicketStatus,
      priority: row.ticket.priority as TicketPriority,
      conversationMode: row.ticket.conversationMode,
      aiAutoReplyEnabled: row.ticket.aiAutoReplyEnabled,
      departmentId: row.ticket.departmentId,
      departmentNameFa: row.departmentNameFa,
      departmentMaxUploadMb: row.departmentMaxUploadMb,
      assignedOperatorId: row.ticket.assignedOperatorId,
      assignedOperatorName: row.assignedOperatorName,
      linkedAiConversationId: row.ticket.linkedAiConversationId,
      lastMessageAt: row.ticket.lastMessageAt.toISOString(),
      createdAt: row.ticket.createdAt.toISOString(),
      resolvedAt: row.ticket.resolvedAt?.toISOString() ?? null,
      closedAt: row.ticket.closedAt?.toISOString() ?? null,
    },
    customer: {
      customerRef: formatCustomerRef(row.customerId),
      fullName: row.customerName,
      phoneMasked: row.customerPhoneMasked,
      recentTicketsInAuthorizedScope: customerRecentTickets.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
      })),
      threadHistory: combinedThreadHistory,
    },
    messages: msgs.map((m) => ({
      id: m.id,
      senderType: m.senderType as 'customer' | 'operator' | 'ai_assistant' | 'system',
      senderLabel:
        m.senderType === 'customer'
          ? row.customerName
          : m.senderType === 'operator'
          ? m.senderOperatorName || 'اپراتور'
          : m.senderType === 'ai_assistant'
          ? 'دستیار هوشمند'
          : 'پیام سامانه',
      visibility: m.visibility as 'public' | 'internal_note',
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      attachments: attByMsg.get(m.id) || [],
    })),
    attachments: atts.map((a) => ({
      id: a.id,
      messageId: a.messageId,
      uploadedByType: a.uploadedByType,
      originalFilename: a.originalFilename,
      mimeType: a.mimeType,
      byteSize: a.byteSize,
      scanStatus: a.scanStatus,
      createdAt: a.createdAt.toISOString(),
    })),
    aiSourceContext: aiRetrievalRows.map((r) => ({
      id: r.id,
      queryText: r.queryText,
      topScore: r.topScore,
      abstained: r.abstained,
      sources: r.sourcesJson,
      createdAt: r.createdAt.toISOString(),
    })),
    assignments: assignments.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
    statusHistory: statusHistoryRows.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
    activities: activityRows.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
    departmentOperators: deptOperators.map((o) => ({
      userId: o.userId,
      name: o.name,
      isAvailable: o.userStatus === 'active' && o.membershipAvailable && o.globalAvailable !== false,
    })),
    transferableDepartments: allDepts,
  };
}

export async function addOperatorTicketMessage(params: {
  access: UserAccessProfile;
  actorName: string;
  ticketId: string;
  body: string;
  visibility: 'public' | 'internal_note';
  files?: UploadedFileInput[];
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const requiredPerm =
    params.visibility === 'internal_note'
      ? 'desk:tickets:internal_notes'
      : 'desk:tickets:reply';
  if (!hasPermission(params.access, requiredPerm)) {
    throw new Error('FORBIDDEN_PERMISSION');
  }

  const rows = await db
    .select({
      ticket: tickets,
      maxUploadSizeMb: departments.maxUploadSizeMb,
    })
    .from(tickets)
    .innerJoin(departments, eq(tickets.departmentId, departments.id))
    .where(eq(tickets.id, params.ticketId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (!canAccessDepartment(params.access, row.ticket.departmentId)) {
    throw new Error('DEPARTMENT_ACCESS_DENIED');
  }

  const validatedFiles =
    params.visibility === 'public'
      ? await prepareValidatedAttachments(params.files ?? [], row.maxUploadSizeMb)
      : [];
  const storedFiles = await storeAttachmentPayloads(validatedFiles);

  try {
    const now = new Date();
    const messageId = `tmsg_${randomUUID()}`;

    await db.transaction(async (tx) => {
      await tx.insert(ticketMessages).values({
        id: messageId,
        ticketId: row.ticket.id,
        senderType: 'operator',
        senderUserId: params.access.userId,
        visibility: params.visibility,
        body: params.body.trim(),
        createdAt: now,
      });

      for (const s of storedFiles) {
        await tx.insert(ticketAttachments).values({
          id: `tatt_${randomUUID()}`,
          ticketId: row.ticket.id,
          messageId,
          uploadedByType: 'operator',
          uploadedByUserId: params.access.userId,
          originalFilename: s.payload.originalFilename,
          storageKey: s.storageKey,
          mimeType: s.payload.mimeType,
          fileExtension: s.payload.extension,
          byteSize: s.payload.byteSize,
          sha256: s.payload.sha256,
          scanStatus: s.payload.scanStatus,
        });
      }

      if (params.visibility === 'public') {
        const nextStatus: TicketStatus =
          row.ticket.status === 'resolved' || row.ticket.status === 'closed'
            ? (row.ticket.status as TicketStatus)
            : 'waiting_for_customer';

        await tx
          .update(tickets)
          .set({
            status: nextStatus,
            conversationMode: 'human_operator_active',
            aiAutoReplyEnabled: false,
            assignedOperatorId: row.ticket.assignedOperatorId ?? params.access.userId,
            lastMessageAt: now,
            updatedAt: now,
          })
          .where(eq(tickets.id, row.ticket.id));

        if (row.ticket.linkedAiConversationId) {
          await tx
            .update(aiConversations)
            .set({
              mode: 'human_operator_active',
              aiAutoReplyEnabled: false,
              escalatedToHuman: true,
              updatedAt: now,
            })
            .where(eq(aiConversations.id, row.ticket.linkedAiConversationId));
        }

        if (nextStatus !== row.ticket.status) {
          await tx.insert(ticketStatusHistory).values({
            id: `tsh_${randomUUID()}`,
            ticketId: row.ticket.id,
            fromStatus: row.ticket.status,
            toStatus: nextStatus,
            changedByType: 'operator',
            changedByUserId: params.access.userId,
          });
        }
      }

      await tx.insert(ticketActivity).values({
        id: `tact_${randomUUID()}`,
        ticketId: row.ticket.id,
        activityType:
          params.visibility === 'internal_note' ? 'internal_note_added' : 'operator_replied',
        actorLabel: params.actorName,
        detailsJson: {
          messageId,
          visibility: params.visibility,
          attachmentCount: storedFiles.length,
        },
      });
    });

    await recordAuditLog({
      actorUserId: params.access.userId,
      action:
        params.visibility === 'internal_note'
          ? 'ticket.internal_note_added'
          : 'ticket.operator_replied',
      targetType: 'ticket',
      targetId: row.ticket.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: {
        messageId,
        visibility: params.visibility,
        departmentId: row.ticket.departmentId,
      },
    });

    return getOperatorTicketDetail(params.access, row.ticket.id);
  } catch (err) {
    const driver = getStorageDriver();
    await Promise.all(storedFiles.map((s) => driver.delete(s.storageKey).catch(() => {})));
    throw err;
  }
}

export async function updateTicketMeta(params: {
  access: UserAccessProfile;
  actorName: string;
  ticketId: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  aiAutoReplyEnabled?: boolean;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  if (!hasPermission(params.access, 'desk:tickets:reply')) {
    throw new Error('FORBIDDEN_PERMISSION');
  }

  const existing = await db.query.tickets.findFirst({
    where: eq(tickets.id, params.ticketId),
  });
  if (!existing) return null;

  if (!canAccessDepartment(params.access, existing.departmentId)) {
    throw new Error('DEPARTMENT_ACCESS_DENIED');
  }

  const now = new Date();
  const nextStatus = params.status ?? (existing.status as TicketStatus);
  const nextPriority = params.priority ?? (existing.priority as TicketPriority);
  const nextAiAuto =
    params.aiAutoReplyEnabled !== undefined
      ? params.aiAutoReplyEnabled
      : existing.aiAutoReplyEnabled;

  await db.transaction(async (tx) => {
    await tx
      .update(tickets)
      .set({
        status: nextStatus,
        priority: nextPriority,
        aiAutoReplyEnabled: nextAiAuto,
        conversationMode:
          nextStatus === 'resolved' || nextStatus === 'closed'
            ? 'resolved'
            : existing.conversationMode,
        resolvedAt:
          nextStatus === 'resolved' ? existing.resolvedAt ?? now : existing.resolvedAt,
        closedAt: nextStatus === 'closed' ? existing.closedAt ?? now : existing.closedAt,
        updatedAt: now,
      })
      .where(eq(tickets.id, existing.id));

    if (nextStatus !== existing.status) {
      await tx.insert(ticketStatusHistory).values({
        id: `tsh_${randomUUID()}`,
        ticketId: existing.id,
        fromStatus: existing.status,
        toStatus: nextStatus,
        changedByType: 'operator',
        changedByUserId: params.access.userId,
      });
    }

    await tx.insert(ticketActivity).values({
      id: `tact_${randomUUID()}`,
      ticketId: existing.id,
      activityType: 'ticket_meta_updated',
      actorLabel: params.actorName,
      detailsJson: {
        statusFrom: existing.status,
        statusTo: nextStatus,
        priorityFrom: existing.priority,
        priorityTo: nextPriority,
        aiAutoReplyEnabled: nextAiAuto,
      },
    });
  });

  await recordAuditLog({
    actorUserId: params.access.userId,
    action: 'ticket.updated',
    targetType: 'ticket',
    targetId: existing.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      status: nextStatus,
      priority: nextPriority,
      aiAutoReplyEnabled: nextAiAuto,
    },
  });

  return getOperatorTicketDetail(params.access, existing.id);
}

export async function reassignTicketOperator(params: {
  access: UserAccessProfile;
  actorName: string;
  ticketId: string;
  operatorId: string | null;
  reason?: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  if (!hasPermission(params.access, 'desk:tickets:assign')) {
    throw new Error('FORBIDDEN_PERMISSION');
  }

  const existing = await db.query.tickets.findFirst({
    where: eq(tickets.id, params.ticketId),
  });
  if (!existing) return null;

  if (!canAccessDepartment(params.access, existing.departmentId)) {
    throw new Error('DEPARTMENT_ACCESS_DENIED');
  }

  let targetOperatorName: string | null = null;
  if (params.operatorId) {
    const member = await db
      .select({ userId: users.id, name: users.name, userStatus: users.status })
      .from(departmentMemberships)
      .innerJoin(users, eq(departmentMemberships.userId, users.id))
      .where(
        and(
          eq(departmentMemberships.departmentId, existing.departmentId),
          eq(departmentMemberships.userId, params.operatorId)
        )
      )
      .limit(1);
    if (!member[0] || member[0].userStatus !== 'active') {
      throw new Error('TARGET_OPERATOR_NOT_ELIGIBLE');
    }
    targetOperatorName = member[0].name;
  }

  const now = new Date();
  const nextStatus: TicketStatus =
    existing.status === 'resolved' || existing.status === 'closed'
      ? (existing.status as TicketStatus)
      : params.operatorId
      ? 'assigned'
      : 'waiting_for_operator';

  await db.transaction(async (tx) => {
    await tx
      .update(tickets)
      .set({
        assignedOperatorId: params.operatorId,
        status: nextStatus,
        conversationMode: params.operatorId ? 'assigned_to_operator' : 'waiting_for_operator',
        updatedAt: now,
      })
      .where(eq(tickets.id, existing.id));

    await tx.insert(ticketAssignments).values({
      id: `tass_${randomUUID()}`,
      ticketId: existing.id,
      fromDepartmentId: existing.departmentId,
      toDepartmentId: existing.departmentId,
      fromOperatorId: existing.assignedOperatorId,
      toOperatorId: params.operatorId,
      assignedByUserId: params.access.userId,
      strategyUsed: 'manual_reassign',
      reason: params.reason || 'تغییر اپراتور مسئول تیکت',
    });

    await tx.insert(ticketActivity).values({
      id: `tact_${randomUUID()}`,
      ticketId: existing.id,
      activityType: 'ticket_reassigned',
      actorLabel: params.actorName,
      detailsJson: {
        fromOperatorId: existing.assignedOperatorId,
        toOperatorId: params.operatorId,
        toOperatorName: targetOperatorName,
      },
    });

    if (params.operatorId && params.operatorId !== params.access.userId) {
      await tx.insert(notifications).values({
        id: `ntf_${randomUUID()}`,
        recipientUserId: params.operatorId,
        ticketId: existing.id,
        type: 'ticket_assigned',
        titleFa: `ارجاع تیکت ${existing.referenceCode}`,
        bodyFa: `${params.actorName} تیکت «${existing.subject}» را به شما تخصیص داد.`,
      });
    }
  });

  await recordAuditLog({
    actorUserId: params.access.userId,
    action: 'ticket.reassigned',
    targetType: 'ticket',
    targetId: existing.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      fromOperatorId: existing.assignedOperatorId,
      toOperatorId: params.operatorId,
    },
  });

  return getOperatorTicketDetail(params.access, existing.id);
}

export async function transferTicketDepartment(params: {
  access: UserAccessProfile;
  actorName: string;
  ticketId: string;
  targetDepartmentId: string;
  operatorId?: string | null;
  reason?: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  if (!hasPermission(params.access, 'desk:tickets:assign')) {
    throw new Error('FORBIDDEN_PERMISSION');
  }

  const existing = await db.query.tickets.findFirst({
    where: eq(tickets.id, params.ticketId),
  });
  if (!existing) return null;

  if (!canAccessDepartment(params.access, existing.departmentId)) {
    throw new Error('DEPARTMENT_ACCESS_DENIED');
  }

  const targetDept = await db.query.departments.findFirst({
    where: eq(departments.id, params.targetDepartmentId),
  });
  if (!targetDept || !targetDept.isActive) {
    throw new Error('TARGET_DEPARTMENT_NOT_AVAILABLE');
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    let nextOperatorId: string | null = null;
    let strategyUsed = 'department_transfer';

    if (params.operatorId) {
      const member = await tx
        .select({ userId: users.id, userStatus: users.status })
        .from(departmentMemberships)
        .innerJoin(users, eq(departmentMemberships.userId, users.id))
        .where(
          and(
            eq(departmentMemberships.departmentId, targetDept.id),
            eq(departmentMemberships.userId, params.operatorId)
          )
        )
        .limit(1);
      if (!member[0] || member[0].userStatus !== 'active') {
        throw new Error('TARGET_OPERATOR_NOT_ELIGIBLE');
      }
      nextOperatorId = member[0].userId;
    } else if (params.operatorId === undefined) {
      const decision = await allocateReferenceAndAssigneeInTx(tx, {
        id: targetDept.id,
        slug: targetDept.slug,
        assignmentStrategy: targetDept.assignmentStrategy,
      });
      nextOperatorId = decision.assignedOperator?.userId ?? null;
      strategyUsed = `transfer_${decision.strategyUsed}`;
    }

    const nextStatus: TicketStatus =
      existing.status === 'resolved' || existing.status === 'closed'
        ? (existing.status as TicketStatus)
        : nextOperatorId
        ? 'assigned'
        : 'waiting_for_operator';

    await tx
      .update(tickets)
      .set({
        departmentId: targetDept.id,
        assignedOperatorId: nextOperatorId,
        status: nextStatus,
        conversationMode: nextOperatorId ? 'assigned_to_operator' : 'waiting_for_operator',
        updatedAt: now,
      })
      .where(eq(tickets.id, existing.id));

    await tx.insert(ticketAssignments).values({
      id: `tass_${randomUUID()}`,
      ticketId: existing.id,
      fromDepartmentId: existing.departmentId,
      toDepartmentId: targetDept.id,
      fromOperatorId: existing.assignedOperatorId,
      toOperatorId: nextOperatorId,
      assignedByUserId: params.access.userId,
      strategyUsed,
      reason: params.reason || `انتقال تیکت به دپارتمان ${targetDept.nameFa}`,
    });

    await tx.insert(ticketMessages).values({
      id: `tmsg_${randomUUID()}`,
      ticketId: existing.id,
      senderType: 'system',
      visibility: 'public',
      body: `این تیکت توسط کارشناس به دپارتمان «${targetDept.nameFa}» منتقل شد.`,
      createdAt: now,
    });

    await tx.insert(ticketActivity).values({
      id: `tact_${randomUUID()}`,
      ticketId: existing.id,
      activityType: 'department_transferred',
      actorLabel: params.actorName,
      detailsJson: {
        fromDepartmentId: existing.departmentId,
        toDepartmentId: targetDept.id,
        toDepartmentNameFa: targetDept.nameFa,
        toOperatorId: nextOperatorId,
      },
    });

    if (nextOperatorId) {
      await tx.insert(notifications).values({
        id: `ntf_${randomUUID()}`,
        recipientUserId: nextOperatorId,
        ticketId: existing.id,
        type: 'ticket_transferred',
        titleFa: `انتقال تیکت ${existing.referenceCode}`,
        bodyFa: `تیکت «${existing.subject}» به دپارتمان ${targetDept.nameFa} منتقل و به شما ارجاع شد.`,
      });
    }
  });

  await recordAuditLog({
    actorUserId: params.access.userId,
    action: 'ticket.transferred_department',
    targetType: 'ticket',
    targetId: existing.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      fromDepartmentId: existing.departmentId,
      toDepartmentId: targetDept.id,
    },
  });

  // Note: If operator no longer has access to target department (e.g., isn't admin/member of target),
  // return minimal transfer confirmation instead of failing with 403 immediately after successful transfer!
  if (!canAccessDepartment(params.access, targetDept.id)) {
    return {
      transferredAway: true,
      targetDepartmentId: targetDept.id,
      targetDepartmentNameFa: targetDept.nameFa,
    };
  }

  const detail = await getOperatorTicketDetail(params.access, existing.id);
  return { transferredAway: false, detail };
}

export async function getOperatorAttachmentForDownload(
  access: UserAccessProfile,
  ticketId: string,
  attachmentId: string
) {
  if (!hasPermission(access, 'desk:workspace:access')) {
    throw new Error('FORBIDDEN_PERMISSION');
  }

  const rows = await db
    .select({
      attachment: ticketAttachments,
      departmentId: tickets.departmentId,
    })
    .from(ticketAttachments)
    .innerJoin(tickets, eq(ticketAttachments.ticketId, tickets.id))
    .where(
      and(
        eq(ticketAttachments.id, attachmentId),
        eq(ticketAttachments.ticketId, ticketId)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (!canAccessDepartment(access, row.departmentId)) {
    throw new Error('DEPARTMENT_ACCESS_DENIED');
  }

  return row.attachment;
}

export async function listUserNotifications(userId: string) {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientUserId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(25);

  const unreadCount = rows.filter((r) => !r.isRead).length;
  return {
    unreadCount,
    items: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function markUserNotificationsRead(
  userId: string,
  ids?: string[]
) {
  if (ids && ids.length > 0) {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.recipientUserId, userId),
          inArray(notifications.id, ids)
        )
      );
  } else {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.recipientUserId, userId));
  }
}

export interface DepartmentTicketQueueSummaryItem {
  departmentId: string;
  slug: string;
  nameFa: string;
  iconKey: string;
  isActive: boolean;
  isMember: boolean;
  isManager: boolean;
  openCount: number;
  awaitingReplyCount: number;
  waitingForOperatorCount: number;
  waitingForCustomerCount: number;
}

export interface DepartmentTicketQueueSummaryResult {
  authorized: boolean;
  scope: 'all_departments' | 'assigned_membership';
  totals: {
    openCount: number;
    awaitingReplyCount: number;
    waitingForOperatorCount: number;
    waitingForCustomerCount: number;
  };
  departments: DepartmentTicketQueueSummaryItem[];
}

export async function getDepartmentTicketQueueSummary(
  access: UserAccessProfile
): Promise<DepartmentTicketQueueSummaryResult> {
  const canViewTickets =
    access.isSuperAdmin ||
    hasPermission(access, 'desk:workspace:access') ||
    hasPermission(access, 'desk:tickets:view_department') ||
    hasPermission(access, 'desk:tickets:view_all');

  const viewAll =
    access.isSuperAdmin || hasPermission(access, 'desk:tickets:view_all');
  const scope: DepartmentTicketQueueSummaryResult['scope'] = viewAll
    ? 'all_departments'
    : 'assigned_membership';

  if (!canViewTickets) {
    return {
      authorized: false,
      scope,
      totals: {
        openCount: 0,
        awaitingReplyCount: 0,
        waitingForOperatorCount: 0,
        waitingForCustomerCount: 0,
      },
      departments: [],
    };
  }

  const authorizedDepts = await listAuthorizedDepartmentsForOperator(access);
  if (authorizedDepts.length === 0) {
    return {
      authorized: true,
      scope,
      totals: {
        openCount: 0,
        awaitingReplyCount: 0,
        waitingForOperatorCount: 0,
        waitingForCustomerCount: 0,
      },
      departments: [],
    };
  }

  const deptIds = authorizedDepts.map((d) => d.id);
  const memberDeptIds = new Set(access.departments.map((d) => d.departmentId));
  const managerDeptIds = new Set(
    access.departments.filter((d) => d.isManager).map((d) => d.departmentId)
  );

  const groupedRows = await db
    .select({
      departmentId: tickets.departmentId,
      openCount: sql<number>`count(*)::int`,
      awaitingReplyCount: sql<number>`count(*) filter (where ${tickets.status} in ('open', 'waiting_for_operator', 'assigned', 'in_progress'))::int`,
      waitingForOperatorCount: sql<number>`count(*) filter (where ${tickets.status} = 'waiting_for_operator')::int`,
      waitingForCustomerCount: sql<number>`count(*) filter (where ${tickets.status} = 'waiting_for_customer')::int`,
    })
    .from(tickets)
    .where(
      and(
        inArray(tickets.departmentId, deptIds),
        notInArray(tickets.status, ['resolved', 'closed'])
      )
    )
    .groupBy(tickets.departmentId);

  const countsByDept = new Map(groupedRows.map((r) => [r.departmentId, r]));

  const items: DepartmentTicketQueueSummaryItem[] = authorizedDepts.map((dept) => {
    const row = countsByDept.get(dept.id);
    return {
      departmentId: dept.id,
      slug: dept.slug,
      nameFa: dept.nameFa,
      iconKey: dept.iconKey,
      isActive: dept.isActive,
      isMember: memberDeptIds.has(dept.id),
      isManager: managerDeptIds.has(dept.id) || dept.isManager,
      openCount: Number(row?.openCount ?? 0),
      awaitingReplyCount: Number(row?.awaitingReplyCount ?? 0),
      waitingForOperatorCount: Number(row?.waitingForOperatorCount ?? 0),
      waitingForCustomerCount: Number(row?.waitingForCustomerCount ?? 0),
    };
  });

  const totals = items.reduce(
    (acc, item) => {
      acc.openCount += item.openCount;
      acc.awaitingReplyCount += item.awaitingReplyCount;
      acc.waitingForOperatorCount += item.waitingForOperatorCount;
      acc.waitingForCustomerCount += item.waitingForCustomerCount;
      return acc;
    },
    {
      openCount: 0,
      awaitingReplyCount: 0,
      waitingForOperatorCount: 0,
      waitingForCustomerCount: 0,
    }
  );

  return {
    authorized: true,
    scope,
    totals,
    departments: items,
  };
}

