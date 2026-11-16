import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { getEnv } from '@/src/core/config/env.ts';
import { db } from '@/src/db/index.ts';
import {
  fileVersions,
  storageQuotas,
  storedFiles,
  systemSettings,
} from '@/src/db/schema.ts';
import { FileHubDomainError } from './error-http.ts';
import {
  SHARED_FILE_EXTENSION_CATALOG,
  type SupportedSharedFileExtension,
} from './schemas.ts';

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface FileHubPolicyConfig {
  allowedExtensions: SupportedSharedFileExtension[];
  maxUploadSizeMb: number;
}

const DEFAULT_FILE_HUB_POLICY: FileHubPolicyConfig = {
  allowedExtensions: [...SHARED_FILE_EXTENSION_CATALOG],
  maxUploadSizeMb: 25,
};

const FILE_HUB_POLICY_KEY = 'file_hub_policy';

export async function getFileHubPolicy(): Promise<FileHubPolicyConfig> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, FILE_HUB_POLICY_KEY),
  });
  if (!row || !row.valueJson) {
    return DEFAULT_FILE_HUB_POLICY;
  }
  const rawExts = Array.isArray(row.valueJson.allowedExtensions)
    ? row.valueJson.allowedExtensions.filter(
        (ext): ext is SupportedSharedFileExtension =>
          typeof ext === 'string' &&
          (SHARED_FILE_EXTENSION_CATALOG as readonly string[]).includes(ext)
      )
    : DEFAULT_FILE_HUB_POLICY.allowedExtensions;
  const maxMb = Number(row.valueJson.maxUploadSizeMb);

  return {
    allowedExtensions:
      rawExts.length > 0 ? rawExts : DEFAULT_FILE_HUB_POLICY.allowedExtensions,
    maxUploadSizeMb:
      Number.isFinite(maxMb) && maxMb >= 1 && maxMb <= 250
        ? Math.floor(maxMb)
        : DEFAULT_FILE_HUB_POLICY.maxUploadSizeMb,
  };
}

export async function saveFileHubPolicy(
  policy: FileHubPolicyConfig,
  updatedBy: string
): Promise<FileHubPolicyConfig> {
  await db
    .insert(systemSettings)
    .values({
      key: FILE_HUB_POLICY_KEY,
      valueJson: {
        allowedExtensions: policy.allowedExtensions,
        maxUploadSizeMb: policy.maxUploadSizeMb,
      },
      isSensitive: false,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        valueJson: {
          allowedExtensions: policy.allowedExtensions,
          maxUploadSizeMb: policy.maxUploadSizeMb,
        },
        updatedBy,
        updatedAt: new Date(),
      },
    });
  return policy;
}

export async function computeLiveUsedBytesTx(
  tx: DbTx,
  scopeType: 'global' | 'department' | 'operator',
  scopeId: string
): Promise<number> {
  if (scopeType === 'global') {
    const [curSum] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${storedFiles.byteSize}), 0)::bigint` })
      .from(storedFiles);
    const [verSum] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${fileVersions.byteSize}), 0)::bigint` })
      .from(fileVersions);
    return Number(curSum?.total ?? 0) + Number(verSum?.total ?? 0);
  }

  if (scopeType === 'department') {
    const [curSum] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${storedFiles.byteSize}), 0)::bigint` })
      .from(storedFiles)
      .where(eq(storedFiles.departmentId, scopeId));
    const [verSum] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${fileVersions.byteSize}), 0)::bigint` })
      .from(fileVersions)
      .innerJoin(storedFiles, eq(fileVersions.fileId, storedFiles.id))
      .where(eq(storedFiles.departmentId, scopeId));
    return Number(curSum?.total ?? 0) + Number(verSum?.total ?? 0);
  }

  // operator scope: sum current files uploaded by operator + archived versions they uploaded
  const [curSum] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${storedFiles.byteSize}), 0)::bigint` })
    .from(storedFiles)
    .where(eq(storedFiles.uploadedByUserId, scopeId));
  const [verSum] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${fileVersions.byteSize}), 0)::bigint` })
    .from(fileVersions)
    .where(eq(fileVersions.replacedByUserId, scopeId));
  return Number(curSum?.total ?? 0) + Number(verSum?.total ?? 0);
}

/**
 * Atomically checks global, department, and operator quotas with PostgreSQL FOR UPDATE row locks
 * and reserves `addedBytes`. Must be called inside a database transaction.
 */
export async function checkAndReserveQuotaTx(
  tx: DbTx,
  params: {
    departmentId: string;
    userId: string;
    addedBytes: number;
  }
): Promise<void> {
  const env = getEnv();

  // Ensure canonical global quota row exists
  await tx
    .insert(storageQuotas)
    .values({
      id: 'quota_global_default',
      scopeType: 'global',
      scopeId: 'global',
      driver: env.STORAGE_DRIVER,
      maxBytes: env.STORAGE_MAX_BYTES,
      usedBytes: 0,
    })
    .onConflictDoNothing();

  // Lock matching quota rows in deterministic order to prevent concurrent race conditions
  const lockedRows = await tx
    .select()
    .from(storageQuotas)
    .where(
      or(
        and(eq(storageQuotas.scopeType, 'global'), eq(storageQuotas.scopeId, 'global')),
        and(
          eq(storageQuotas.scopeType, 'department'),
          eq(storageQuotas.scopeId, params.departmentId)
        ),
        and(
          eq(storageQuotas.scopeType, 'operator'),
          eq(storageQuotas.scopeId, params.userId)
        )
      )
    )
    .orderBy(storageQuotas.id)
    .for('update');

  const globalQuota = lockedRows.find((q) => q.scopeType === 'global');
  const deptQuota = lockedRows.find(
    (q) => q.scopeType === 'department' && q.scopeId === params.departmentId
  );
  const operatorQuota = lockedRows.find(
    (q) => q.scopeType === 'operator' && q.scopeId === params.userId
  );

  if (globalQuota && globalQuota.usedBytes + params.addedBytes > globalQuota.maxBytes) {
    throw new FileHubDomainError(
      'QUOTA_EXCEEDED',
      'ظرفیت کل ذخیره‌سازی سازمان پر شده است.',
      413
    );
  }

  if (deptQuota && deptQuota.usedBytes + params.addedBytes > deptQuota.maxBytes) {
    throw new FileHubDomainError(
      'QUOTA_EXCEEDED',
      'سهمیه حجمی ذخیره‌سازی این دپارتمان تکمیل شده است.',
      413
    );
  }

  if (operatorQuota && operatorQuota.usedBytes + params.addedBytes > operatorQuota.maxBytes) {
    throw new FileHubDomainError(
      'QUOTA_EXCEEDED',
      'سهمیه حجمی بارگذاری حساب کاربری شما تکمیل شده است.',
      413
    );
  }

  const now = new Date();
  for (const row of lockedRows) {
    await tx
      .update(storageQuotas)
      .set({
        usedBytes: row.usedBytes + params.addedBytes,
        updatedAt: now,
      })
      .where(eq(storageQuotas.id, row.id));
  }
}

export async function releaseQuotaTx(
  tx: DbTx,
  params: {
    departmentId: string;
    operatorBreakdown: Array<{ userId: string | null; byteSize: number }>;
    totalFreedBytes: number;
  }
): Promise<void> {
  if (params.totalFreedBytes <= 0) return;

  const userIds = Array.from(
    new Set(
      params.operatorBreakdown
        .map((item) => item.userId)
        .filter((id): id is string => Boolean(id))
    )
  );

  const lockedRows = await tx
    .select()
    .from(storageQuotas)
    .where(
      or(
        and(eq(storageQuotas.scopeType, 'global'), eq(storageQuotas.scopeId, 'global')),
        and(
          eq(storageQuotas.scopeType, 'department'),
          eq(storageQuotas.scopeId, params.departmentId)
        ),
        ...userIds.map((uid) =>
          and(eq(storageQuotas.scopeType, 'operator'), eq(storageQuotas.scopeId, uid))
        )
      )
    )
    .orderBy(storageQuotas.id)
    .for('update');

  const now = new Date();
  for (const row of lockedRows) {
    let decrement = 0;
    if (row.scopeType === 'global' || row.scopeType === 'department') {
      decrement = params.totalFreedBytes;
    } else if (row.scopeType === 'operator') {
      decrement = params.operatorBreakdown
        .filter((item) => item.userId === row.scopeId)
        .reduce((acc, item) => acc + item.byteSize, 0);
    }
    if (decrement > 0) {
      await tx
        .update(storageQuotas)
        .set({
          usedBytes: Math.max(0, row.usedBytes - decrement),
          updatedAt: now,
        })
        .where(eq(storageQuotas.id, row.id));
    }
  }
}

export async function upsertQuotaRecord(params: {
  scopeType: 'global' | 'department' | 'operator';
  scopeId: string;
  maxBytes: number;
}) {
  const env = getEnv();
  return db.transaction(async (tx) => {
    const normalizedScopeId =
      params.scopeType === 'global' ? 'global' : params.scopeId;
    const liveUsed = await computeLiveUsedBytesTx(
      tx,
      params.scopeType,
      normalizedScopeId
    );
    const id =
      params.scopeType === 'global'
        ? 'quota_global_default'
        : `quota_${params.scopeType}_${normalizedScopeId}`;

    const [saved] = await tx
      .insert(storageQuotas)
      .values({
        id,
        scopeType: params.scopeType,
        scopeId: normalizedScopeId,
        driver: env.STORAGE_DRIVER,
        maxBytes: params.maxBytes,
        usedBytes: liveUsed,
      })
      .onConflictDoUpdate({
        target: [storageQuotas.scopeType, storageQuotas.scopeId],
        set: {
          maxBytes: params.maxBytes,
          usedBytes: liveUsed,
          updatedAt: new Date(),
        },
      })
      .returning();

    return saved;
  });
}

export function mbToBytes(mb: number): number {
  return Math.round(mb * 1024 * 1024);
}
