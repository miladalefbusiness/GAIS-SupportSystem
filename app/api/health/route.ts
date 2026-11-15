import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'supportdesk',
    phase: 1,
    version: process.env.APP_VERSION || '0.1.0',
    timestamp: new Date().toISOString(),
  });
}
