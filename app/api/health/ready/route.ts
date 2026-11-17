import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  let dbOk = false;
  let pgvectorOk = false;
  let pendingJobs = 0;
  let runningJobs = 0;

  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;

    const extResult = await db
      .execute(sql`SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')`)
      .catch(() => ({ rows: [] as Array<{ extname: string }> }));
    const extNames = new Set(
      (extResult.rows as Array<{ extname?: string }>).map((r) => r.extname)
    );
    pgvectorOk = extNames.has('vector');

    const jobResult = await db
      .execute(
        sql`SELECT status, count(*)::int AS cnt FROM rag_ingestion_jobs WHERE status IN ('pending', 'running') GROUP BY status`
      )
      .catch(() => ({ rows: [] as Array<{ status: string; cnt: number }> }));
    for (const row of jobResult.rows as Array<{ status: string; cnt: number }>) {
      if (row.status === 'pending') pendingJobs = Number(row.cnt || 0);
      if (row.status === 'running') runningJobs = Number(row.cnt || 0);
    }
  } catch {
    dbOk = false;
  }

  const storage = await getStorageDriver().healthCheck();
  const ready = dbOk && storage.ok;

  return NextResponse.json(
    {
      status: ready ? 'ready' : 'degraded',
      checks: {
        database: { ok: dbOk, pgvector: pgvectorOk },
        storage: { ok: storage.ok, driver: storage.driver },
        workerQueue: { pendingJobs, runningJobs },
      },
      version: process.env.APP_VERSION || '0.1.0',
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 }
  );
}
