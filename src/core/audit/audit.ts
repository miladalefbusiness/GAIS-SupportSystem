import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import { auditLogs } from '../../db/schema.ts';
import { logger } from '../logging/logger.ts';

export interface AuditEventInput {
  actorUserId?: string | null;
  actorType?: 'user' | 'system' | 'anonymous';
  action: string;
  targetType?: string;
  targetId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAuditLog(input: AuditEventInput): Promise<void> {
  try {
    const safeMetadata = input.metadata
      ? (logger.sanitize(input.metadata) as Record<string, unknown>)
      : null;

    await db.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType ?? (input.actorUserId ? 'user' : 'system'),
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadataJson: safeMetadata,
    });
  } catch (error) {
    logger.error('audit.write_failed', {
      action: input.action,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export function extractRequestContext(headers: Headers) {
  const forwarded = headers.get('x-forwarded-for');
  const ipAddress = forwarded ? forwarded.split(',')[0].trim() : headers.get('x-real-ip');
  const userAgent = headers.get('user-agent');
  return {
    ipAddress: ipAddress || null,
    userAgent: userAgent ? userAgent.slice(0, 500) : null,
  };
}
