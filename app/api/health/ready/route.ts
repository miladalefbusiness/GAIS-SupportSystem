import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const storage = await getStorageDriver().healthCheck();
  const ready = dbOk && storage.ok;

  return NextResponse.json(
    {
      status: ready ? 'ready' : 'degraded',
      checks: {
        database: { ok: dbOk },
        storage: { ok: storage.ok, driver: storage.driver },
      },
      version: process.env.APP_VERSION || '0.1.0',
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 }
  );
}
