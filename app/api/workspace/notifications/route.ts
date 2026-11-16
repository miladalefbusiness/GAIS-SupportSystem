import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/src/core/auth/guards.ts';
import {
  listUserNotifications,
  markUserNotificationsRead,
} from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

const markReadSchema = z.object({
  ids: z.array(z.string()).optional(),
});

export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const result = await listUserNotifications(guard.session.user.id);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = markReadSchema.safeParse(body);
  await markUserNotificationsRead(
    guard.session.user.id,
    parsed.success ? parsed.data.ids : undefined
  );

  const result = await listUserNotifications(guard.session.user.id);
  return NextResponse.json(result);
}
