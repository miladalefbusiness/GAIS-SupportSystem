import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { hasPermission, type UserAccessProfile } from '@/src/core/auth/rbac.ts';
import { getEnv } from '@/src/core/config/env.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import {
  auditLogs,
  departments,
  fileFolders,
  filePermissions,
  fileVersions,
  storageQuotas,
  storedFiles,
  users,
} from '@/src/db/schema.ts';
import {
  canUploadToDepartment,
  evaluateFileAccess,
  evaluateFolderAccess,
  hasGlobalFileManage,
  isDepartmentMemberForFiles,
  loadMatchingGrantsForUser,
} from './authz.ts';
import { FileHubDomainError } from './error-http.ts';
import {
  checkAndReserveQuotaTx,
  getFileHubPolicy,
  mbToBytes,
  releaseQuotaTx,
  saveFileHubPolicy,
  upsertQuotaRecord,
} from './quotas.ts';
import type { SupportedSharedFileExtension } from './schemas.ts';
import {
  buildSharedFileStorageKey,
  validateSharedFileUpload,
} from './validation.ts';

export interface RequestAuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

function assertAuthenticatedUserId(access: UserAccessProfile): string {
  if (!access.userId) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شناسه کاربر احراز هویت شده در دسترس نیست.',
      403
    );
  }
  return access.userId;
}

export async function listFileHubWorkspace(
  access: UserAccessProfile,
  params: {
    departmentId?: string;
    folderId?: string | null;
    search?: string;
    extension?: string;
  }
) {
  const canAccess =
    hasGlobalFileManage(access) ||
    (hasPermission(access, 'files:workspace:access') &&
      hasPermission(access, 'files:items:view'));

  if (!canAccess) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز مشاهده مخزن فایل اشتراکی را ندارید.',
      403
    );
  }

  const userId = assertAuthenticatedUserId(access);
  const [allDepts, grants, policy] = await Promise.all([
    db
      .select({
        id: departments.id,
        slug: departments.slug,
        nameFa: departments.nameFa,
        isActive: departments.isActive,
        maxUploadSizeMb: departments.maxUploadSizeMb,
        displayOrder: departments.displayOrder,
      })
      .from(departments)
      .where(eq(departments.isActive, true))
      .orderBy(asc(departments.displayOrder), asc(departments.nameFa)),
    loadMatchingGrantsForUser(access),
    getFileHubPolicy(),
  ]);

  // Identify departments that have shared_read_all_departments items or explicit user/dept grants
  const [sharedFolderDepts, sharedFileDepts] = await Promise.all([
    db
      .selectDistinct({ departmentId: fileFolders.departmentId })
      .from(fileFolders)
      .where(eq(fileFolders.accessPolicy, 'shared_read_all_departments')),
    db
      .selectDistinct({ departmentId: storedFiles.departmentId })
      .from(storedFiles)
      .where(eq(storedFiles.accessPolicy, 'shared_read_all_departments')),
  ]);

  const sharedDeptIds = new Set<string>([
    ...sharedFolderDepts.map((r) => r.departmentId),
    ...sharedFileDepts.map((r) => r.departmentId),
    ...grants.map((g) => g.departmentId),
  ]);

  const globalManage = hasGlobalFileManage(access);
  const visibleDepartments = allDepts
    .filter(
      (dept) =>
        globalManage ||
        isDepartmentMemberForFiles(access, dept.id) ||
        sharedDeptIds.has(dept.id)
    )
    .map((dept) => {
      const isMember = isDepartmentMemberForFiles(access, dept.id);
      const canUploadHere = canUploadToDepartment(access, dept.id, null, grants);
      return {
        id: dept.id,
        slug: dept.slug,
        nameFa: dept.nameFa,
        isMember,
        canUpload: canUploadHere,
        effectiveMaxUploadMb: Math.min(
          policy.maxUploadSizeMb,
          dept.maxUploadSizeMb || policy.maxUploadSizeMb
        ),
      };
    });

  const selectedDept =
    (params.departmentId
      ? visibleDepartments.find((d) => d.id === params.departmentId)
      : undefined) ||
    visibleDepartments.find((d) => d.isMember) ||
    visibleDepartments[0] ||
    null;

  if (!selectedDept) {
    return {
      departments: [],
      activeDepartment: null,
      folders: [],
      breadcrumbs: [],
      files: [],
      policy,
      quotas: { global: null, department: null, operator: null },
    };
  }

  // Load all folders & files in the selected department, then filter strictly server-side
  const [deptFolders, deptFiles, quotaRows] = await Promise.all([
    db
      .select({
        id: fileFolders.id,
        departmentId: fileFolders.departmentId,
        parentFolderId: fileFolders.parentFolderId,
        name: fileFolders.name,
        description: fileFolders.description,
        ownerLabel: fileFolders.ownerLabel,
        accessPolicy: fileFolders.accessPolicy,
        createdByUserId: fileFolders.createdByUserId,
        createdAt: fileFolders.createdAt,
        updatedAt: fileFolders.updatedAt,
      })
      .from(fileFolders)
      .where(eq(fileFolders.departmentId, selectedDept.id))
      .orderBy(asc(fileFolders.name)),
    db
      .select({
        id: storedFiles.id,
        departmentId: storedFiles.departmentId,
        folderId: storedFiles.folderId,
        uploadedByUserId: storedFiles.uploadedByUserId,
        uploaderName: users.name,
        uploaderUsername: users.username,
        title: storedFiles.title,
        description: storedFiles.description,
        originalFilename: storedFiles.originalFilename,
        mimeType: storedFiles.mimeType,
        fileExtension: storedFiles.fileExtension,
        byteSize: storedFiles.byteSize,
        sha256: storedFiles.sha256,
        scanStatus: storedFiles.scanStatus,
        versionNumber: storedFiles.versionNumber,
        accessPolicy: storedFiles.accessPolicy,
        downloadCount: storedFiles.downloadCount,
        lastDownloadedAt: storedFiles.lastDownloadedAt,
        createdAt: storedFiles.createdAt,
        updatedAt: storedFiles.updatedAt,
      })
      .from(storedFiles)
      .leftJoin(users, eq(storedFiles.uploadedByUserId, users.id))
      .where(eq(storedFiles.departmentId, selectedDept.id))
      .orderBy(desc(storedFiles.createdAt)),
    db
      .select()
      .from(storageQuotas)
      .where(
        or(
          and(eq(storageQuotas.scopeType, 'global'), eq(storageQuotas.scopeId, 'global')),
          and(
            eq(storageQuotas.scopeType, 'department'),
            eq(storageQuotas.scopeId, selectedDept.id)
          ),
          and(eq(storageQuotas.scopeType, 'operator'), eq(storageQuotas.scopeId, userId))
        )
      ),
  ]);

  const folderById = new Map(deptFolders.map((f) => [f.id, f]));

  const accessibleFolders = deptFolders
    .map((folder) => {
      const decision = evaluateFolderAccess(access, folder, grants);
      return {
        ...folder,
        ...decision,
        createdAt: folder.createdAt.toISOString(),
        updatedAt: folder.updatedAt.toISOString(),
      };
    })
    .filter((f) => f.canView);

  const accessibleFolderIdSet = new Set(accessibleFolders.map((f) => f.id));

  // Validate requested folderId if any
  const requestedFolderId =
    params.folderId && params.folderId !== 'all' ? params.folderId : null;
  if (requestedFolderId && !accessibleFolderIdSet.has(requestedFolderId)) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'پوشه درخواستی یافت نشد یا دسترسی به آن برای شما مجاز نیست.',
      403
    );
  }

  // Build breadcrumbs for requested folder
  const breadcrumbs: Array<{ id: string; name: string }> = [];
  let cursorId = requestedFolderId;
  let guardCount = 0;
  while (cursorId && guardCount < 20) {
    const folder = folderById.get(cursorId);
    if (!folder) break;
    if (accessibleFolderIdSet.has(folder.id)) {
      breadcrumbs.unshift({ id: folder.id, name: folder.name });
    }
    cursorId = folder.parentFolderId;
    guardCount += 1;
  }

  const searchLower = params.search?.trim().toLowerCase() || '';
  const extFilter = params.extension?.trim().toLowerCase() || '';
  const showAllFolders = params.folderId === 'all' || Boolean(searchLower);

  const visibleFolders = accessibleFolders.filter((f) => {
    if (showAllFolders) {
      return searchLower
        ? f.name.toLowerCase().includes(searchLower) ||
            (f.ownerLabel || '').toLowerCase().includes(searchLower)
        : false;
    }
    return (f.parentFolderId ?? null) === requestedFolderId;
  });

  const visibleFiles = deptFiles
    .map((file) => {
      const parentFolder = file.folderId ? folderById.get(file.folderId) : undefined;
      const decision = evaluateFileAccess(
        access,
        file,
        parentFolder?.accessPolicy,
        grants
      );
      return {
        ...file,
        folderName: parentFolder?.name ?? null,
        canView: decision.canView,
        canDownload: decision.canDownload,
        canManage: decision.canManage,
        effectivePolicy: decision.effectivePolicy,
        lastDownloadedAt: file.lastDownloadedAt
          ? file.lastDownloadedAt.toISOString()
          : null,
        createdAt: file.createdAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
      };
    })
    .filter((file) => {
      if (!file.canView) return false;
      if (!showAllFolders && (file.folderId ?? null) !== requestedFolderId) {
        return false;
      }
      if (extFilter && file.fileExtension.toLowerCase() !== extFilter) {
        return false;
      }
      if (searchLower) {
        const hay = [
          file.title,
          file.originalFilename,
          file.description,
          file.uploaderName || '',
          file.folderName || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(searchLower)) return false;
      }
      return true;
    });

  const activeFolderUpload = requestedFolderId
    ? canUploadToDepartment(access, selectedDept.id, requestedFolderId, grants)
    : selectedDept.canUpload;

  const globalQ = quotaRows.find((q) => q.scopeType === 'global') ?? null;
  const deptQ =
    quotaRows.find(
      (q) => q.scopeType === 'department' && q.scopeId === selectedDept.id
    ) ?? null;
  const opQ =
    quotaRows.find((q) => q.scopeType === 'operator' && q.scopeId === userId) ?? null;

  return {
    departments: visibleDepartments,
    activeDepartment: {
      ...selectedDept,
      canUploadInCurrentFolder: activeFolderUpload,
    },
    folders: visibleFolders,
    allAccessibleFolders: accessibleFolders.map((f) => ({
      id: f.id,
      name: f.name,
      parentFolderId: f.parentFolderId,
      canManage: f.canManage,
    })),
    breadcrumbs,
    files: visibleFiles,
    policy,
    quotas: {
      global: globalQ
        ? { maxBytes: globalQ.maxBytes, usedBytes: globalQ.usedBytes }
        : null,
      department: deptQ
        ? { maxBytes: deptQ.maxBytes, usedBytes: deptQ.usedBytes }
        : null,
      operator: opQ ? { maxBytes: opQ.maxBytes, usedBytes: opQ.usedBytes } : null,
    },
  };
}

export async function getFileDetailWithVersions(
  access: UserAccessProfile,
  fileId: string
) {
  const file = await db.query.storedFiles.findFirst({
    where: eq(storedFiles.id, fileId),
  });
  if (!file) {
    throw new FileHubDomainError('NOT_FOUND', 'فایل درخواستی یافت نشد.', 404);
  }

  const [folder, grants, uploader, versionRows] = await Promise.all([
    file.folderId
      ? db.query.fileFolders.findFirst({ where: eq(fileFolders.id, file.folderId) })
      : Promise.resolve(undefined),
    loadMatchingGrantsForUser(access, file.departmentId),
    file.uploadedByUserId
      ? db.query.users.findFirst({
          where: eq(users.id, file.uploadedByUserId),
          columns: { id: true, name: true, username: true },
        })
      : Promise.resolve(undefined),
    db
      .select({
        id: fileVersions.id,
        versionNumber: fileVersions.versionNumber,
        originalFilename: fileVersions.originalFilename,
        mimeType: fileVersions.mimeType,
        fileExtension: fileVersions.fileExtension,
        byteSize: fileVersions.byteSize,
        sha256: fileVersions.sha256,
        changeNote: fileVersions.changeNote,
        replacedByName: users.name,
        createdAt: fileVersions.createdAt,
      })
      .from(fileVersions)
      .leftJoin(users, eq(fileVersions.replacedByUserId, users.id))
      .where(eq(fileVersions.fileId, fileId))
      .orderBy(desc(fileVersions.versionNumber)),
  ]);

  const decision = evaluateFileAccess(access, file, folder?.accessPolicy, grants);
  if (!decision.canView) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز مشاهده جزئیات این فایل را ندارید.',
      403
    );
  }

  return {
    file: {
      id: file.id,
      departmentId: file.departmentId,
      folderId: file.folderId,
      folderName: folder?.name ?? null,
      title: file.title,
      description: file.description,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
      fileExtension: file.fileExtension,
      byteSize: file.byteSize,
      sha256: file.sha256,
      scanStatus: file.scanStatus,
      versionNumber: file.versionNumber,
      accessPolicy: file.accessPolicy,
      effectivePolicy: decision.effectivePolicy,
      downloadCount: file.downloadCount,
      lastDownloadedAt: file.lastDownloadedAt
        ? file.lastDownloadedAt.toISOString()
        : null,
      uploaderName: uploader?.name ?? null,
      uploaderUsername: uploader?.username ?? null,
      canDownload: decision.canDownload,
      canManage: decision.canManage,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
    },
    versions: versionRows.map((v) => ({
      ...v,
      createdAt: v.createdAt.toISOString(),
    })),
  };
}

export async function createFolder(
  access: UserAccessProfile,
  input: {
    departmentId: string;
    parentFolderId?: string | null;
    name: string;
    description?: string;
    ownerLabel?: string | null;
    accessPolicy?: 'department_only' | 'shared_read_all_departments';
  },
  ctx: RequestAuditContext = {}
) {
  const userId = assertAuthenticatedUserId(access);
  const grants = await loadMatchingGrantsForUser(access, input.departmentId);

  if (
    !canUploadToDepartment(
      access,
      input.departmentId,
      input.parentFolderId ?? null,
      grants
    )
  ) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز ایجاد پوشه در این دپارتمان را ندارید.',
      403
    );
  }

  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, input.departmentId),
  });
  if (!dept || !dept.isActive) {
    throw new FileHubDomainError(
      'NOT_FOUND',
      'دپارتمان انتخاب‌شده یافت نشد یا غیرفعال است.',
      404
    );
  }

  const parentId = input.parentFolderId ?? null;
  if (parentId) {
    const parent = await db.query.fileFolders.findFirst({
      where: eq(fileFolders.id, parentId),
    });
    if (!parent || parent.departmentId !== input.departmentId) {
      throw new FileHubDomainError(
        'BAD_REQUEST',
        'پوشه والد نامعتبر است یا به دپارتمان دیگری تعلق دارد.',
        400
      );
    }
  }

  const trimmedName = input.name.trim();
  const siblings = await db
    .select({ id: fileFolders.id, name: fileFolders.name })
    .from(fileFolders)
    .where(eq(fileFolders.departmentId, input.departmentId));

  // Verify no duplicate sibling name under same parent
  const siblingsUnderParent = await db
    .select({ id: fileFolders.id, name: fileFolders.name, parentFolderId: fileFolders.parentFolderId })
    .from(fileFolders)
    .where(eq(fileFolders.departmentId, input.departmentId));

  const dup = siblingsUnderParent.find(
    (s) =>
      (s.parentFolderId ?? null) === parentId &&
      s.name.trim().toLowerCase() === trimmedName.toLowerCase()
  );
  if (dup) {
    throw new FileHubDomainError(
      'CONFLICT',
      'پوشه‌ای با این نام در همین مسیر وجود دارد.',
      409
    );
  }
  void siblings;

  const [created] = await db
    .insert(fileFolders)
    .values({
      id: randomUUID(),
      departmentId: input.departmentId,
      parentFolderId: parentId,
      name: trimmedName,
      description: input.description?.trim() ?? '',
      ownerLabel: input.ownerLabel?.trim() || null,
      accessPolicy: input.accessPolicy ?? 'department_only',
      createdByUserId: userId,
    })
    .returning();

  await recordAuditLog({
    actorUserId: userId,
    action: 'files.folder.created',
    targetType: 'file_folder',
    targetId: created.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: created.departmentId,
      parentFolderId: created.parentFolderId,
      name: created.name,
      accessPolicy: created.accessPolicy,
    },
  });

  return created;
}

export async function updateFolder(
  access: UserAccessProfile,
  folderId: string,
  input: {
    name?: string;
    description?: string;
    ownerLabel?: string | null;
    accessPolicy?: 'department_only' | 'shared_read_all_departments';
  },
  ctx: RequestAuditContext = {}
) {
  const userId = assertAuthenticatedUserId(access);
  const existing = await db.query.fileFolders.findFirst({
    where: eq(fileFolders.id, folderId),
  });
  if (!existing) {
    throw new FileHubDomainError('NOT_FOUND', 'پوشه مورد نظر یافت نشد.', 404);
  }

  const grants = await loadMatchingGrantsForUser(access, existing.departmentId);
  const decision = evaluateFolderAccess(access, existing, grants);
  if (!decision.canManage) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز ویرایش پوشه‌های این دپارتمان را ندارید.',
      403
    );
  }

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    const deptFolders = await db
      .select({
        id: fileFolders.id,
        name: fileFolders.name,
        parentFolderId: fileFolders.parentFolderId,
      })
      .from(fileFolders)
      .where(eq(fileFolders.departmentId, existing.departmentId));

    const dup = deptFolders.find(
      (f) =>
        f.id !== existing.id &&
        (f.parentFolderId ?? null) === (existing.parentFolderId ?? null) &&
        f.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (dup) {
      throw new FileHubDomainError(
        'CONFLICT',
        'پوشه‌ای با این نام در همین مسیر وجود دارد.',
        409
      );
    }
  }

  const [updated] = await db
    .update(fileFolders)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() }
        : {}),
      ...(input.ownerLabel !== undefined
        ? { ownerLabel: input.ownerLabel?.trim() || null }
        : {}),
      ...(input.accessPolicy !== undefined ? { accessPolicy: input.accessPolicy } : {}),
      updatedAt: new Date(),
    })
    .where(eq(fileFolders.id, existing.id))
    .returning();

  await recordAuditLog({
    actorUserId: userId,
    action: 'files.folder.updated',
    targetType: 'file_folder',
    targetId: updated.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: updated.departmentId,
      name: updated.name,
      accessPolicy: updated.accessPolicy,
    },
  });

  return updated;
}

export async function deleteFolder(
  access: UserAccessProfile,
  folderId: string,
  ctx: RequestAuditContext = {}
) {
  const userId = assertAuthenticatedUserId(access);
  const existing = await db.query.fileFolders.findFirst({
    where: eq(fileFolders.id, folderId),
  });
  if (!existing) {
    throw new FileHubDomainError('NOT_FOUND', 'پوشه مورد نظر یافت نشد.', 404);
  }

  const grants = await loadMatchingGrantsForUser(access, existing.departmentId);
  const decision = evaluateFolderAccess(access, existing, grants);
  if (!decision.canManage) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز حذف پوشه‌های این دپارتمان را ندارید.',
      403
    );
  }

  // Collect folder subtree + contained files + archived versions
  const deptFolders = await db
    .select({ id: fileFolders.id, parentFolderId: fileFolders.parentFolderId })
    .from(fileFolders)
    .where(eq(fileFolders.departmentId, existing.departmentId));

  const subtreeIds = new Set<string>([existing.id]);
  let added = true;
  while (added) {
    added = false;
    for (const f of deptFolders) {
      if (f.parentFolderId && subtreeIds.has(f.parentFolderId) && !subtreeIds.has(f.id)) {
        subtreeIds.add(f.id);
        added = true;
      }
    }
  }

  const subtreeList = Array.from(subtreeIds);

  const storageKeysToDelete: string[] = [];

  const deletedSummary = await db.transaction(async (tx) => {
    const filesInSubtree = await tx
      .select()
      .from(storedFiles)
      .where(inArray(storedFiles.folderId, subtreeList));

    let totalFreed = 0;
    const operatorBreakdown: Array<{ userId: string | null; byteSize: number }> = [];

    if (filesInSubtree.length > 0) {
      const fileIds = filesInSubtree.map((f) => f.id);
      const versionsInSubtree = await tx
        .select()
        .from(fileVersions)
        .where(inArray(fileVersions.fileId, fileIds));

      for (const f of filesInSubtree) {
        totalFreed += f.byteSize;
        operatorBreakdown.push({ userId: f.uploadedByUserId, byteSize: f.byteSize });
        storageKeysToDelete.push(f.storageKey);
      }
      for (const v of versionsInSubtree) {
        totalFreed += v.byteSize;
        operatorBreakdown.push({ userId: v.replacedByUserId, byteSize: v.byteSize });
        storageKeysToDelete.push(v.storageKey);
      }

      await tx.delete(storedFiles).where(inArray(storedFiles.id, fileIds));
      await releaseQuotaTx(tx, {
        departmentId: existing.departmentId,
        operatorBreakdown,
        totalFreedBytes: totalFreed,
      });
    }

    await tx.delete(fileFolders).where(eq(fileFolders.id, existing.id));

    return {
      deletedFolderId: existing.id,
      deletedSubfolderCount: subtreeList.length,
      deletedFileCount: filesInSubtree.length,
      freedBytes: totalFreed,
    };
  });

  const driver = getStorageDriver();
  await Promise.all(storageKeysToDelete.map((key) => driver.delete(key).catch(() => {})));

  await recordAuditLog({
    actorUserId: userId,
    action: 'files.folder.deleted',
    targetType: 'file_folder',
    targetId: existing.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: existing.departmentId,
      name: existing.name,
      ...deletedSummary,
    },
  });

  return deletedSummary;
}

export async function uploadSharedFile(
  access: UserAccessProfile,
  params: {
    departmentId: string;
    folderId?: string | null;
    title?: string;
    description?: string;
    accessPolicy?: 'inherit' | 'department_only' | 'shared_read_all_departments';
    filename: string;
    buffer: Buffer;
  },
  ctx: RequestAuditContext = {}
) {
  const userId = assertAuthenticatedUserId(access);
  const grants = await loadMatchingGrantsForUser(access, params.departmentId);

  if (
    !canUploadToDepartment(
      access,
      params.departmentId,
      params.folderId ?? null,
      grants
    )
  ) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز بارگذاری فایل در این دپارتمان را ندارید.',
      403
    );
  }

  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, params.departmentId),
  });
  if (!dept || !dept.isActive) {
    throw new FileHubDomainError(
      'NOT_FOUND',
      'دپارتمان انتخاب‌شده یافت نشد یا غیرفعال است.',
      404
    );
  }

  const folderId = params.folderId ?? null;
  if (folderId) {
    const folder = await db.query.fileFolders.findFirst({
      where: eq(fileFolders.id, folderId),
    });
    if (!folder || folder.departmentId !== params.departmentId) {
      throw new FileHubDomainError(
        'BAD_REQUEST',
        'پوشه انتخاب‌شده متعلق به این دپارتمان نیست.',
        400
      );
    }
  }

  const policy = await getFileHubPolicy();
  const effectiveMaxMb = Math.min(
    policy.maxUploadSizeMb,
    dept.maxUploadSizeMb || policy.maxUploadSizeMb
  );

  const validated = await validateSharedFileUpload({
    filename: params.filename,
    buffer: params.buffer,
    maxUploadSizeMb: effectiveMaxMb,
    allowedExtensions: policy.allowedExtensions,
  });

  const storageKey = buildSharedFileStorageKey(params.departmentId, validated.extension);
  const title = (params.title || '').trim() || validated.originalFilename;

  const created = await db.transaction(async (tx) => {
    await checkAndReserveQuotaTx(tx, {
      departmentId: params.departmentId,
      userId,
      addedBytes: validated.byteSize,
    });

    const [inserted] = await tx
      .insert(storedFiles)
      .values({
        id: randomUUID(),
        departmentId: params.departmentId,
        folderId,
        uploadedByUserId: userId,
        title,
        description: params.description?.trim() ?? '',
        originalFilename: validated.originalFilename,
        storageKey,
        mimeType: validated.mimeType,
        fileExtension: validated.extension,
        byteSize: validated.byteSize,
        sha256: validated.sha256,
        scanStatus: validated.scanStatus,
        versionNumber: 1,
        accessPolicy: params.accessPolicy ?? 'inherit',
      })
      .returning();

    // Persist buffer while holding quota/insert tx; failure rolls back DB cleanly
    await getStorageDriver().put(storageKey, validated.buffer);

    return inserted;
  });

  await recordAuditLog({
    actorUserId: userId,
    action: 'files.item.uploaded',
    targetType: 'stored_file',
    targetId: created.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: created.departmentId,
      folderId: created.folderId,
      originalFilename: created.originalFilename,
      byteSize: created.byteSize,
      fileExtension: created.fileExtension,
      accessPolicy: created.accessPolicy,
    },
  });

  return created;
}

export async function replaceSharedFile(
  access: UserAccessProfile,
  fileId: string,
  params: {
    filename: string;
    buffer: Buffer;
    changeNote?: string;
  },
  ctx: RequestAuditContext = {}
) {
  const userId = assertAuthenticatedUserId(access);
  const existing = await db.query.storedFiles.findFirst({
    where: eq(storedFiles.id, fileId),
  });
  if (!existing) {
    throw new FileHubDomainError('NOT_FOUND', 'فایل مورد نظر یافت نشد.', 404);
  }

  const [folder, dept, grants, policy] = await Promise.all([
    existing.folderId
      ? db.query.fileFolders.findFirst({ where: eq(fileFolders.id, existing.folderId) })
      : Promise.resolve(undefined),
    db.query.departments.findFirst({
      where: eq(departments.id, existing.departmentId),
    }),
    loadMatchingGrantsForUser(access, existing.departmentId),
    getFileHubPolicy(),
  ]);

  const decision = evaluateFileAccess(access, existing, folder?.accessPolicy, grants);
  if (!decision.canManage) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز جایگزینی فایل‌های این دپارتمان را ندارید.',
      403
    );
  }

  const effectiveMaxMb = Math.min(
    policy.maxUploadSizeMb,
    dept?.maxUploadSizeMb || policy.maxUploadSizeMb
  );

  const validated = await validateSharedFileUpload({
    filename: params.filename,
    buffer: params.buffer,
    maxUploadSizeMb: effectiveMaxMb,
    allowedExtensions: policy.allowedExtensions,
  });

  const newStorageKey = buildSharedFileStorageKey(
    existing.departmentId,
    validated.extension
  );

  const updated = await db.transaction(async (tx) => {
    await checkAndReserveQuotaTx(tx, {
      departmentId: existing.departmentId,
      userId,
      addedBytes: validated.byteSize,
    });

    await tx.insert(fileVersions).values({
      id: randomUUID(),
      fileId: existing.id,
      versionNumber: existing.versionNumber,
      originalFilename: existing.originalFilename,
      storageKey: existing.storageKey,
      mimeType: existing.mimeType,
      fileExtension: existing.fileExtension,
      byteSize: existing.byteSize,
      sha256: existing.sha256,
      replacedByUserId: userId,
      changeNote: params.changeNote?.trim() || null,
    });

    const [nextFile] = await tx
      .update(storedFiles)
      .set({
        originalFilename: validated.originalFilename,
        storageKey: newStorageKey,
        mimeType: validated.mimeType,
        fileExtension: validated.extension,
        byteSize: validated.byteSize,
        sha256: validated.sha256,
        scanStatus: validated.scanStatus,
        versionNumber: existing.versionNumber + 1,
        updatedAt: new Date(),
      })
      .where(eq(storedFiles.id, existing.id))
      .returning();

    await getStorageDriver().put(newStorageKey, validated.buffer);
    return nextFile;
  });

  await recordAuditLog({
    actorUserId: userId,
    action: 'files.item.replaced',
    targetType: 'stored_file',
    targetId: updated.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: updated.departmentId,
      previousVersion: existing.versionNumber,
      newVersion: updated.versionNumber,
      byteSize: updated.byteSize,
    },
  });

  return updated;
}

export async function updateSharedFileMetadata(
  access: UserAccessProfile,
  fileId: string,
  input: {
    title?: string;
    description?: string;
    folderId?: string | null;
    accessPolicy?: 'inherit' | 'department_only' | 'shared_read_all_departments';
  },
  ctx: RequestAuditContext = {}
) {
  const userId = assertAuthenticatedUserId(access);
  const existing = await db.query.storedFiles.findFirst({
    where: eq(storedFiles.id, fileId),
  });
  if (!existing) {
    throw new FileHubDomainError('NOT_FOUND', 'فایل مورد نظر یافت نشد.', 404);
  }

  const [currentFolder, grants] = await Promise.all([
    existing.folderId
      ? db.query.fileFolders.findFirst({ where: eq(fileFolders.id, existing.folderId) })
      : Promise.resolve(undefined),
    loadMatchingGrantsForUser(access, existing.departmentId),
  ]);

  const decision = evaluateFileAccess(access, existing, currentFolder?.accessPolicy, grants);
  if (!decision.canManage) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز ویرایش یا جابه‌جایی فایل‌های این دپارتمان را ندارید.',
      403
    );
  }

  if (input.folderId !== undefined && input.folderId !== null) {
    const targetFolder = await db.query.fileFolders.findFirst({
      where: eq(fileFolders.id, input.folderId),
    });
    if (!targetFolder || targetFolder.departmentId !== existing.departmentId) {
      throw new FileHubDomainError(
        'BAD_REQUEST',
        'پوشه مقصد نامعتبر است یا به دپارتمان دیگری تعلق دارد.',
        400
      );
    }
  }

  const [updated] = await db
    .update(storedFiles)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() }
        : {}),
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.accessPolicy !== undefined ? { accessPolicy: input.accessPolicy } : {}),
      updatedAt: new Date(),
    })
    .where(eq(storedFiles.id, existing.id))
    .returning();

  await recordAuditLog({
    actorUserId: userId,
    action: 'files.item.updated',
    targetType: 'stored_file',
    targetId: updated.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: updated.departmentId,
      folderId: updated.folderId,
      accessPolicy: updated.accessPolicy,
      title: updated.title,
    },
  });

  return updated;
}

export async function deleteSharedFile(
  access: UserAccessProfile,
  fileId: string,
  ctx: RequestAuditContext = {}
) {
  const userId = assertAuthenticatedUserId(access);
  const existing = await db.query.storedFiles.findFirst({
    where: eq(storedFiles.id, fileId),
  });
  if (!existing) {
    throw new FileHubDomainError('NOT_FOUND', 'فایل مورد نظر یافت نشد.', 404);
  }

  const [folder, grants] = await Promise.all([
    existing.folderId
      ? db.query.fileFolders.findFirst({ where: eq(fileFolders.id, existing.folderId) })
      : Promise.resolve(undefined),
    loadMatchingGrantsForUser(access, existing.departmentId),
  ]);

  const decision = evaluateFileAccess(access, existing, folder?.accessPolicy, grants);
  if (!decision.canManage) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز حذف فایل‌های این دپارتمان را ندارید.',
      403
    );
  }

  const storageKeysToDelete: string[] = [existing.storageKey];

  const freedBytes = await db.transaction(async (tx) => {
    const versions = await tx
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, existing.id));

    let totalFreed = existing.byteSize;
    const operatorBreakdown: Array<{ userId: string | null; byteSize: number }> = [
      { userId: existing.uploadedByUserId, byteSize: existing.byteSize },
    ];

    for (const v of versions) {
      totalFreed += v.byteSize;
      operatorBreakdown.push({ userId: v.replacedByUserId, byteSize: v.byteSize });
      storageKeysToDelete.push(v.storageKey);
    }

    await tx.delete(storedFiles).where(eq(storedFiles.id, existing.id));
    await releaseQuotaTx(tx, {
      departmentId: existing.departmentId,
      operatorBreakdown,
      totalFreedBytes: totalFreed,
    });

    return totalFreed;
  });

  const driver = getStorageDriver();
  await Promise.all(storageKeysToDelete.map((key) => driver.delete(key).catch(() => {})));

  await recordAuditLog({
    actorUserId: userId,
    action: 'files.item.deleted',
    targetType: 'stored_file',
    targetId: existing.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: existing.departmentId,
      originalFilename: existing.originalFilename,
      freedBytes,
    },
  });

  return { deletedId: existing.id, freedBytes };
}

export async function downloadSharedFile(
  access: UserAccessProfile,
  fileId: string,
  versionNumber?: number,
  ctx: RequestAuditContext = {}
) {
  const userId = assertAuthenticatedUserId(access);
  const existing = await db.query.storedFiles.findFirst({
    where: eq(storedFiles.id, fileId),
  });
  if (!existing) {
    throw new FileHubDomainError('NOT_FOUND', 'فایل درخواستی یافت نشد.', 404);
  }

  const [folder, grants] = await Promise.all([
    existing.folderId
      ? db.query.fileFolders.findFirst({ where: eq(fileFolders.id, existing.folderId) })
      : Promise.resolve(undefined),
    loadMatchingGrantsForUser(access, existing.departmentId),
  ]);

  const decision = evaluateFileAccess(access, existing, folder?.accessPolicy, grants);
  if (!decision.canDownload) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز دریافت این فایل را ندارید.',
      403
    );
  }

  let targetStorageKey = existing.storageKey;
  let targetFilename = existing.originalFilename;
  let targetMime = existing.mimeType;
  let targetVersion = existing.versionNumber;

  if (versionNumber !== undefined && versionNumber !== existing.versionNumber) {
    const versionRow = await db.query.fileVersions.findFirst({
      where: and(
        eq(fileVersions.fileId, existing.id),
        eq(fileVersions.versionNumber, versionNumber)
      ),
    });
    if (!versionRow) {
      throw new FileHubDomainError(
        'NOT_FOUND',
        'نسخه درخواستی این فایل یافت نشد.',
        404
      );
    }
    targetStorageKey = versionRow.storageKey;
    targetFilename = versionRow.originalFilename;
    targetMime = versionRow.mimeType;
    targetVersion = versionRow.versionNumber;
  }

  const buffer = await getStorageDriver().get(targetStorageKey);

  await db
    .update(storedFiles)
    .set({
      downloadCount: sql`${storedFiles.downloadCount} + 1`,
      lastDownloadedAt: new Date(),
    })
    .where(eq(storedFiles.id, existing.id));

  await recordAuditLog({
    actorUserId: userId,
    action: 'files.item.downloaded',
    targetType: 'stored_file',
    targetId: existing.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: existing.departmentId,
      originalFilename: targetFilename,
      versionNumber: targetVersion,
    },
  });

  return {
    buffer,
    originalFilename: targetFilename,
    mimeType: targetMime,
    versionNumber: targetVersion,
  };
}

// ============================================================================
// Super Admin / Quota Manager Storage Administration Services
// ============================================================================

export function canManageStorageAdmin(access: UserAccessProfile): boolean {
  return (
    access.isSuperAdmin ||
    hasPermission(access, 'admin:storage:manage') ||
    hasPermission(access, 'files:quotas:manage')
  );
}

export async function getStorageAdminOverview(access: UserAccessProfile) {
  if (!canManageStorageAdmin(access)) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز مدیریت ذخیره‌سازی و سهمیه‌ها را ندارید.',
      403
    );
  }

  const env = getEnv();
  const [
    health,
    policy,
    quotaRows,
    allDepts,
    allUsers,
    deptCurrentSums,
    deptVersionSums,
    opCurrentSums,
    opVersionSums,
    permissionRows,
    recentAuditRows,
  ] = await Promise.all([
    getStorageDriver().healthCheck(),
    getFileHubPolicy(),
    db.select().from(storageQuotas).orderBy(asc(storageQuotas.scopeType)),
    db
      .select({
        id: departments.id,
        nameFa: departments.nameFa,
        slug: departments.slug,
        isActive: departments.isActive,
        maxUploadSizeMb: departments.maxUploadSizeMb,
      })
      .from(departments)
      .orderBy(asc(departments.displayOrder), asc(departments.nameFa)),
    db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        status: users.status,
      })
      .from(users)
      .orderBy(asc(users.name)),
    db
      .select({
        departmentId: storedFiles.departmentId,
        fileCount: sql<number>`COUNT(*)::int`,
        bytes: sql<number>`COALESCE(SUM(${storedFiles.byteSize}), 0)::bigint`,
      })
      .from(storedFiles)
      .groupBy(storedFiles.departmentId),
    db
      .select({
        departmentId: storedFiles.departmentId,
        bytes: sql<number>`COALESCE(SUM(${fileVersions.byteSize}), 0)::bigint`,
      })
      .from(fileVersions)
      .innerJoin(storedFiles, eq(fileVersions.fileId, storedFiles.id))
      .groupBy(storedFiles.departmentId),
    db
      .select({
        userId: storedFiles.uploadedByUserId,
        fileCount: sql<number>`COUNT(*)::int`,
        bytes: sql<number>`COALESCE(SUM(${storedFiles.byteSize}), 0)::bigint`,
      })
      .from(storedFiles)
      .groupBy(storedFiles.uploadedByUserId),
    db
      .select({
        userId: fileVersions.replacedByUserId,
        bytes: sql<number>`COALESCE(SUM(${fileVersions.byteSize}), 0)::bigint`,
      })
      .from(fileVersions)
      .groupBy(fileVersions.replacedByUserId),
    db
      .select({
        id: filePermissions.id,
        departmentId: filePermissions.departmentId,
        folderId: filePermissions.folderId,
        fileId: filePermissions.fileId,
        targetType: filePermissions.targetType,
        targetId: filePermissions.targetId,
        canView: filePermissions.canView,
        canDownload: filePermissions.canDownload,
        canUpload: filePermissions.canUpload,
        canManage: filePermissions.canManage,
        note: filePermissions.note,
        createdAt: filePermissions.createdAt,
      })
      .from(filePermissions)
      .orderBy(desc(filePermissions.createdAt))
      .limit(100),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        actorName: users.name,
        actorUsername: users.username,
        metadataJson: auditLogs.metadataJson,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(
        or(like(auditLogs.action, 'files.%'), like(auditLogs.action, 'admin.storage.%'))
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(40),
  ]);

  const deptCurMap = new Map(deptCurrentSums.map((r) => [r.departmentId, r]));
  const deptVerMap = new Map(deptVersionSums.map((r) => [r.departmentId, Number(r.bytes)]));
  const opCurMap = new Map(opCurrentSums.map((r) => [r.userId || '', r]));
  const opVerMap = new Map(opVersionSums.map((r) => [r.userId || '', Number(r.bytes)]));

  const globalQuotaRow = quotaRows.find((q) => q.scopeType === 'global');

  const departmentUsage = allDepts.map((dept) => {
    const cur = deptCurMap.get(dept.id);
    const usedBytes = Number(cur?.bytes ?? 0) + (deptVerMap.get(dept.id) ?? 0);
    const quota = quotaRows.find(
      (q) => q.scopeType === 'department' && q.scopeId === dept.id
    );
    return {
      departmentId: dept.id,
      nameFa: dept.nameFa,
      slug: dept.slug,
      isActive: dept.isActive,
      maxUploadSizeMb: dept.maxUploadSizeMb,
      fileCount: cur?.fileCount ?? 0,
      usedBytes,
      quotaMaxBytes: quota ? quota.maxBytes : null,
    };
  });

  const operatorUsage = allUsers.map((u) => {
    const cur = opCurMap.get(u.id);
    const usedBytes = Number(cur?.bytes ?? 0) + (opVerMap.get(u.id) ?? 0);
    const quota = quotaRows.find(
      (q) => q.scopeType === 'operator' && q.scopeId === u.id
    );
    return {
      userId: u.id,
      name: u.name,
      username: u.username,
      status: u.status,
      fileCount: cur?.fileCount ?? 0,
      usedBytes,
      quotaMaxBytes: quota ? quota.maxBytes : null,
    };
  });

  const totalUsedBytes = departmentUsage.reduce((acc, d) => acc + d.usedBytes, 0);
  const totalFiles = departmentUsage.reduce((acc, d) => acc + d.fileCount, 0);
  const deptNameById = new Map(allDepts.map((d) => [d.id, d.nameFa]));
  const userNameById = new Map(
    allUsers.map((u) => [u.id, `${u.name} (@${u.username})`])
  );

  return {
    storageHealth: {
      ok: health.ok,
      driver: health.driver,
      writable: health.writable,
    },
    globalQuota: {
      maxBytes: globalQuotaRow?.maxBytes ?? env.STORAGE_MAX_BYTES,
      usedBytes: totalUsedBytes,
      recordedUsedBytes: globalQuotaRow?.usedBytes ?? totalUsedBytes,
      totalFiles,
    },
    policy,
    departmentUsage,
    operatorUsage,
    permissions: permissionRows.map((p) => ({
      ...p,
      departmentName: deptNameById.get(p.departmentId) || p.departmentId,
      targetLabel:
        p.targetType === 'user'
          ? userNameById.get(p.targetId) || p.targetId
          : deptNameById.get(p.targetId) || p.targetId,
      createdAt: p.createdAt.toISOString(),
    })),
    recentAudit: recentAuditRows.map((a) => ({
      id: a.id,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      actorName: a.actorName,
      actorUsername: a.actorUsername,
      metadata: a.metadataJson,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function updateStorageQuotaAdmin(
  access: UserAccessProfile,
  input: {
    scopeType: 'global' | 'department' | 'operator';
    scopeId: string;
    maxMb: number;
  },
  ctx: RequestAuditContext = {}
) {
  if (!canManageStorageAdmin(access)) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز تغییر سهمیه‌های ذخیره‌سازی را ندارید.',
      403
    );
  }
  const actorId = assertAuthenticatedUserId(access);

  if (input.scopeType === 'department') {
    const dept = await db.query.departments.findFirst({
      where: eq(departments.id, input.scopeId),
    });
    if (!dept) {
      throw new FileHubDomainError('NOT_FOUND', 'دپارتمان هدف یافت نشد.', 404);
    }
  } else if (input.scopeType === 'operator') {
    const user = await db.query.users.findFirst({
      where: eq(users.id, input.scopeId),
    });
    if (!user) {
      throw new FileHubDomainError('NOT_FOUND', 'کاربر هدف یافت نشد.', 404);
    }
  }

  const saved = await upsertQuotaRecord({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    maxBytes: mbToBytes(input.maxMb),
  });

  await recordAuditLog({
    actorUserId: actorId,
    action: 'admin.storage.quota_updated',
    targetType: 'storage_quota',
    targetId: saved.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      scopeType: saved.scopeType,
      scopeId: saved.scopeId,
      maxBytes: saved.maxBytes,
      usedBytes: saved.usedBytes,
    },
  });

  return saved;
}

export async function updateFileHubPolicyAdmin(
  access: UserAccessProfile,
  input: {
    allowedExtensions: SupportedSharedFileExtension[];
    maxUploadSizeMb: number;
  },
  ctx: RequestAuditContext = {}
) {
  if (!canManageStorageAdmin(access)) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز تغییر سیاست نوع فایل و سقف بارگذاری را ندارید.',
      403
    );
  }
  const actorId = assertAuthenticatedUserId(access);
  const saved = await saveFileHubPolicy(input, actorId);

  await recordAuditLog({
    actorUserId: actorId,
    action: 'admin.storage.policy_updated',
    targetType: 'system_setting',
    targetId: 'file_hub_policy',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      allowedExtensions: saved.allowedExtensions,
      maxUploadSizeMb: saved.maxUploadSizeMb,
    },
  });

  return saved;
}

export async function grantFilePermissionAdmin(
  access: UserAccessProfile,
  input: {
    departmentId: string;
    folderId?: string | null;
    fileId?: string | null;
    targetType: 'user' | 'department';
    targetId: string;
    canView: boolean;
    canDownload: boolean;
    canUpload: boolean;
    canManage: boolean;
    note?: string | null;
  },
  ctx: RequestAuditContext = {}
) {
  if (!canManageStorageAdmin(access) && !hasGlobalFileManage(access)) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز تعریف استثناهای دسترسی فایل را ندارید.',
      403
    );
  }
  const actorId = assertAuthenticatedUserId(access);

  const [created] = await db
    .insert(filePermissions)
    .values({
      id: randomUUID(),
      departmentId: input.departmentId,
      folderId: input.folderId ?? null,
      fileId: input.fileId ?? null,
      targetType: input.targetType,
      targetId: input.targetId,
      canView: input.canView,
      canDownload: input.canDownload,
      canUpload: input.canUpload,
      canManage: input.canManage,
      note: input.note?.trim() || null,
      grantedByUserId: actorId,
    })
    .returning();

  await recordAuditLog({
    actorUserId: actorId,
    action: 'admin.storage.permission_granted',
    targetType: 'file_permission',
    targetId: created.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: created.departmentId,
      folderId: created.folderId,
      fileId: created.fileId,
      targetType: created.targetType,
      targetId: created.targetId,
      canView: created.canView,
      canDownload: created.canDownload,
      canUpload: created.canUpload,
      canManage: created.canManage,
    },
  });

  return created;
}

export async function revokeFilePermissionAdmin(
  access: UserAccessProfile,
  permissionId: string,
  ctx: RequestAuditContext = {}
) {
  if (!canManageStorageAdmin(access) && !hasGlobalFileManage(access)) {
    throw new FileHubDomainError(
      'FORBIDDEN',
      'شما مجوز حذف استثناهای دسترسی فایل را ندارید.',
      403
    );
  }
  const actorId = assertAuthenticatedUserId(access);

  const [deleted] = await db
    .delete(filePermissions)
    .where(eq(filePermissions.id, permissionId))
    .returning();

  if (!deleted) {
    throw new FileHubDomainError('NOT_FOUND', 'قانون دسترسی یافت نشد.', 404);
  }

  await recordAuditLog({
    actorUserId: actorId,
    action: 'admin.storage.permission_revoked',
    targetType: 'file_permission',
    targetId: deleted.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      departmentId: deleted.departmentId,
      targetType: deleted.targetType,
      targetId: deleted.targetId,
    },
  });

  return { deletedId: deleted.id };
}
