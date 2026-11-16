import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission, requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { createCollectionSchema } from '@/src/modules/knowledge/schemas.ts';
import {
  createKnowledgeCollection,
  listKnowledgeCollectionsAdmin,
} from '@/src/modules/knowledge/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAnyPermission(['kb:workspace:access', 'kb:entries:manage']);
  if (!guard.ok) return guard.response;

  try {
    const collections = await listKnowledgeCollectionsAdmin();
    return NextResponse.json({ collections });
  } catch (error) {
    logger.error('admin.kb.collections_list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت مجموعه‌های دانش.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('kb:entries:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = createCollectionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات مجموعه دانش نامعتبر است.' },
        { status: 400 }
      );
    }

    const collection = await createKnowledgeCollection({
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ collection }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('knowledge_collections_slug_unique') || msg.includes('unique')) {
      return NextResponse.json(
        { error: 'این شناسه انگلیسی (slug) قبلاً ثبت شده است.' },
        { status: 409 }
      );
    }
    logger.error('admin.kb.collection_create_failed', { error: msg });
    return NextResponse.json(
      { error: 'خطا در ایجاد مجموعه دانش.' },
      { status: 500 }
    );
  }
}
