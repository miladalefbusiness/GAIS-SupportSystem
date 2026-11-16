import { eq, gt, sql } from 'drizzle-orm';
import { getEnv } from '@/src/core/config/env.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import {
  aiProviderSettings,
  auditLogs,
  authSessions,
  customerSessions,
  departments,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeQaEntries,
  storageQuotas,
  storedFiles,
  ticketMessages,
  tickets,
  users,
} from '@/src/db/schema.ts';

export async function getSystemHealthDiagnostics() {
  const env = getEnv();
  const now = new Date();
  const dbStart = Date.now();

  let dbConnected = false;
  let dbLatencyMs = 0;
  let pgVersion = '—';
  let databaseBytes = 0;

  try {
    const versionRes = await db.execute<{
      pg_version: string;
      db_bytes: string | number;
    }>(
      sql`SELECT split_part(version(), ' ', 2) AS pg_version, pg_database_size(current_database())::bigint AS db_bytes`
    );
    dbLatencyMs = Date.now() - dbStart;
    dbConnected = true;
    const row = versionRes.rows[0];
    if (row) {
      pgVersion = String(row.pg_version || 'PostgreSQL');
      databaseBytes = Number(row.db_bytes || 0);
    }
  } catch {
    dbLatencyMs = Date.now() - dbStart;
    dbConnected = false;
  }

  const [
    storageHealth,
    aiSettingsRow,
    globalQuotaRow,
    countsResult,
  ] = await Promise.all([
    getStorageDriver().healthCheck(),
    db.query.aiProviderSettings
      .findFirst({
        where: eq(aiProviderSettings.id, 'default'),
      })
      .catch(() => undefined),
    db.query.storageQuotas
      .findFirst({
        where: eq(storageQuotas.id, 'quota_global_default'),
      })
      .catch(() => undefined),
    Promise.all([
      db.select({ c: sql<number>`COUNT(*)::int` }).from(users),
      db.select({ c: sql<number>`COUNT(*)::int` }).from(departments),
      db.select({ c: sql<number>`COUNT(*)::int` }).from(tickets),
      db.select({ c: sql<number>`COUNT(*)::int` }).from(ticketMessages),
      db.select({ c: sql<number>`COUNT(*)::int` }).from(storedFiles),
      db.select({ c: sql<number>`COUNT(*)::int` }).from(knowledgeDocuments),
      db.select({ c: sql<number>`COUNT(*)::int` }).from(knowledgeChunks),
      db.select({ c: sql<number>`COUNT(*)::int` }).from(knowledgeQaEntries),
      db.select({ c: sql<number>`COUNT(*)::int` }).from(auditLogs),
      db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(authSessions)
        .where(gt(authSessions.expiresAt, now)),
      db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(customerSessions)
        .where(gt(customerSessions.expiresAt, now)),
    ]).catch(() => null),
  ]);

  const mem = process.memoryUsage();

  return {
    checkedAt: now.toISOString(),
    runtime: {
      appVersion: env.APP_VERSION,
      phase: 7,
      nodeVersion: process.version,
      nodeEnv: env.NODE_ENV,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryRssBytes: mem.rss,
      memoryHeapUsedBytes: mem.heapUsed,
    },
    database: {
      ok: dbConnected,
      latencyMs: dbLatencyMs,
      pgVersion,
      databaseBytes,
    },
    storage: {
      ok: storageHealth.ok,
      driver: storageHealth.driver,
      writable: storageHealth.writable,
      globalMaxBytes: globalQuotaRow?.maxBytes ?? env.STORAGE_MAX_BYTES,
      globalUsedBytes: globalQuotaRow?.usedBytes ?? 0,
    },
    integrations: {
      aiConfigured: Boolean(aiSettingsRow?.encryptedApiKey),
      aiGlobalEnabled: Boolean(aiSettingsRow?.globalEnabled),
      aiProviderType: aiSettingsRow?.providerType || 'gemini',
      aiChatModel: aiSettingsRow?.chatModel || 'gemini-4-hydrogen',
      aiLastTestOk: aiSettingsRow?.lastTestOk ?? null,
      aiLastTestedAt: aiSettingsRow?.lastTestedAt
        ? aiSettingsRow.lastTestedAt.toISOString()
        : null,
      otpDeliveryMode: process.env.OTP_DELIVERY_MODE || 'dev_mock',
      avScannerMode: process.env.AV_SCANNER_MODE || 'disabled',
    },
    counts: countsResult
      ? {
          users: countsResult[0][0]?.c ?? 0,
          departments: countsResult[1][0]?.c ?? 0,
          tickets: countsResult[2][0]?.c ?? 0,
          ticketMessages: countsResult[3][0]?.c ?? 0,
          storedFiles: countsResult[4][0]?.c ?? 0,
          knowledgeDocuments: countsResult[5][0]?.c ?? 0,
          knowledgeChunks: countsResult[6][0]?.c ?? 0,
          knowledgeQaEntries: countsResult[7][0]?.c ?? 0,
          auditLogs: countsResult[8][0]?.c ?? 0,
          activeStaffSessions: countsResult[9][0]?.c ?? 0,
          activeCustomerSessions: countsResult[10][0]?.c ?? 0,
        }
      : null,
  };
}
