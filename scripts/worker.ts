import 'dotenv/config';
import fs from 'node:fs/promises';
import { and, eq, lt } from 'drizzle-orm';
import { logger } from '../src/core/logging/logger.ts';
import { db, pool } from '../src/db/index.ts';
import { ragIngestionJobs } from '../src/db/schema.ts';
import { processPendingIngestionJobs } from '../src/modules/rag/jobs/ingestion-worker.ts';

const POLL_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.WORKER_POLL_INTERVAL_MS || 3000)
);
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE || '/tmp/supportdesk-worker-heartbeat';
const STALE_LOCK_MS = 15 * 60 * 1000;

let shuttingDown = false;
let activeCycle: Promise<void> | null = null;

async function touchHeartbeat() {
  try {
    await fs.writeFile(HEARTBEAT_FILE, String(Date.now()), 'utf8');
  } catch {
    // Non-fatal if /tmp is unavailable
  }
}

async function recoverStaleRunningJobs() {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS);
  const recovered = await db
    .update(ragIngestionJobs)
    .set({
      status: 'pending',
      stage: 'queued',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ragIngestionJobs.status, 'running'),
        lt(ragIngestionJobs.updatedAt, cutoff)
      )
    )
    .returning({ id: ragIngestionJobs.id });

  if (recovered.length > 0) {
    logger.warn('worker.recovered_stale_jobs', { count: recovered.length });
  }
}

async function runCycle() {
  await touchHeartbeat();
  await recoverStaleRunningJobs();
  const result = await processPendingIngestionJobs(10);
  if (result.processed > 0) {
    logger.info('worker.cycle_completed', result);
  }
  await touchHeartbeat();
}

async function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function main() {
  logger.info('worker.started', {
    pollIntervalMs: POLL_INTERVAL_MS,
    pid: process.pid,
  });

  const handleSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('worker.shutdown_requested', { signal });
  };

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));

  while (!shuttingDown) {
    activeCycle = runCycle().catch((err) => {
      logger.error('worker.cycle_error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    await activeCycle;
    activeCycle = null;

    if (!shuttingDown) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  logger.info('worker.stopping_db_pool');
  await pool.end();
  logger.info('worker.stopped');
}

main().catch(async (err) => {
  logger.error('worker.fatal_error', {
    error: err instanceof Error ? err.message : String(err),
  });
  await pool.end().catch(() => {});
  process.exit(1);
});
