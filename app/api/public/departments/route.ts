import { NextResponse } from 'next/server';
import { listPublicDepartments } from '@/src/modules/departments/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const items = await listPublicDepartments();
    return NextResponse.json({ departments: items });
  } catch {
    return NextResponse.json(
      { error: 'خطا در دریافت فهرست دپارتمان‌ها.' },
      { status: 500 }
    );
  }
}
