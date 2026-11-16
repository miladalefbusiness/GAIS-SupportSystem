import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractRequestContext, recordAuditLog } from '@/src/core/audit/audit.ts';
import { requireAuth } from '@/src/core/auth/guards.ts';
import { db } from '@/src/db/index.ts';
import { operatorAvailability } from '@/src/db/schema.ts';

const availabilitySchema = z.object({
  isAvailable: z.boolean(),
  availabilityNote: z.string().trim().max(250).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);
  const body = await req.json();
  const parsed = availabilitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'وضعیت در دسترس بودن نامعتبر است.' },
      { status: 400 }
    );
  }

  const existing = await db.query.operatorAvailability.findFirst({
    where: eq(operatorAvailability.userId, guard.session.user.id),
  });

  await db
    .insert(operatorAvailability)
    .values({
      userId: guard.session.user.id,
      isAvailable: parsed.data.isAvailable,
      availabilityNote:
        parsed.data.availabilityNote !== undefined
          ? parsed.data.availabilityNote
          : existing?.availabilityNote ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: operatorAvailability.userId,
      set: {
        isAvailable: parsed.data.isAvailable,
        ...(parsed.data.availabilityNote !== undefined
          ? { availabilityNote: parsed.data.availabilityNote }
          : {}),
        updatedAt: new Date(),
      },
    });

  await recordAuditLog({
    actorUserId: guard.session.user.id,
    action: 'operator.availability.updated',
    targetType: 'user',
    targetId: guard.session.user.id,
    ipAddress,
    userAgent,
    metadata: { isAvailable: parsed.data.isAvailable },
  });

  return NextResponse.json({
    ok: true,
    isAvailable: parsed.data.isAvailable,
  });
}
