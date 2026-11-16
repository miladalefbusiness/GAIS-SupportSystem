import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/src/core/logging/logger.ts';
import { getPublicConversationHistory } from '@/src/modules/ai/chat.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const history = await getPublicConversationHistory(id);
    if (!history) {
      return NextResponse.json(
        { error: 'گفت‌وگو یافت نشد.' },
        { status: 404 }
      );
    }
    return NextResponse.json(history);
  } catch (error) {
    logger.error('public.ai.history_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت تاریخچه گفت‌وگو.' },
      { status: 500 }
    );
  }
}
