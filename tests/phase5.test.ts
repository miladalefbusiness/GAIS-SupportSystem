import 'dotenv/config';
import { eq, inArray, like, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UserAccessProfile } from '../src/core/auth/rbac.ts';
import { getStorageDriver } from '../src/core/storage/local-storage.ts';
import { db, pool } from '../src/db/index.ts';
import {
  auditLogs,
  departmentMemberships,
  departments,
  fileFolders,
  filePermissions,
  fileVersions,
  storageQuotas,
  storedFiles,
  systemSettings,
  users,
} from '../src/db/schema.ts';
import {
  getFileHubPolicy,
  saveFileHubPolicy,
  type FileHubPolicyConfig,
} from '../src/modules/files/quotas.ts';
import {
  createFolder,
  deleteFolder,
  deleteSharedFile,
  downloadSharedFile,
  getFileDetailWithVersions,
  getStorageAdminOverview,
  grantFilePermissionAdmin,
  listFileHubWorkspace,
  replaceSharedFile,
  revokeFilePermissionAdmin,
  updateFileHubPolicyAdmin,
  updateFolder,
  updateSharedFileMetadata,
  updateStorageQuotaAdmin,
  uploadSharedFile,
} from '../src/modules/files/service.ts';

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

const VALID_PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'ascii');

const MZ_SPOOFED_PNG = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
]);

const P5_DEPT_A = 'p5test_dept_a';
const P5_DEPT_B = 'p5test_dept_b';
const P5_USER_A = 'p5test_user_a';
const P5_USER_B = 'p5test_user_b';
const P5_USER_VIEW_ONLY = 'p5test_user_view';
const P5_ADMIN = 'p5test_admin';

function buildFileOperatorAccess(
  userId: string,
  deptIds: string[],
  options?: { canUpload?: boolean; isSuperAdmin?: boolean; extraPerms?: string[] }
): UserAccessProfile {
  const perms = options?.isSuperAdmin
    ? [
        'files:workspace:access',
        'files:items:view',
        'files:items:upload',
        'files:items:manage_all',
        'files:quotas:manage',
        'admin:storage:manage',
      ]
    : [
        'files:workspace:access',
        'files:items:view',
        ...(options?.canUpload === false ? [] : ['files:items:upload']),
        ...(options?.extraPerms || []),
      ];

  return {
    userId,
    roles: [
      {
        id: options?.isSuperAdmin ? 'role_super_admin' : 'role_file_operator',
        slug: options?.isSuperAdmin ? 'super_admin' : 'file_operator',
        nameFa: options?.isSuperAdmin ? 'مدیر ارشد' : 'اپراتور مخزن فایل',
      },
    ],
    permissions: perms,
    departments: deptIds.map((departmentId) => ({
      departmentId,
      slug: departmentId,
      nameFa: departmentId,
      isActive: true,
      isManager: false,
      isAvailable: true,
      maxActiveTickets: 10,
    })),
    isSuperAdmin: Boolean(options?.isSuperAdmin),
  };
}

describe('Phase 5: Shared File Hub, Cross-Department Isolation & Quotas', () => {
  let originalPolicySetting: FileHubPolicyConfig | null = null;
  let hadPolicySettingRow = false;
  const createdStorageKeys: string[] = [];

  beforeAll(async () => {
    const existingPolicy = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'file_hub_policy'),
    });
    if (existingPolicy) {
      hadPolicySettingRow = true;
      originalPolicySetting = await getFileHubPolicy();
    }

    await db
      .insert(users)
      .values([
        {
          id: P5_USER_A,
          username: 'p5test_user_a',
          email: 'p5test_a@local.test',
          name: 'اپراتور فایل دپارتمان الف',
          status: 'active',
        },
        {
          id: P5_USER_B,
          username: 'p5test_user_b',
          email: 'p5test_b@local.test',
          name: 'اپراتور فایل دپارتمان ب',
          status: 'active',
        },
        {
          id: P5_USER_VIEW_ONLY,
          username: 'p5test_user_view',
          email: 'p5test_view@local.test',
          name: 'کاربر فقط مشاهده',
          status: 'active',
        },
        {
          id: P5_ADMIN,
          username: 'p5test_admin',
          email: 'p5test_admin@local.test',
          name: 'مدیر ارشد تست ۵',
          status: 'active',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(departments)
      .values([
        {
          id: P5_DEPT_A,
          slug: 'p5test-dept-a',
          nameFa: 'دپارتمان آزمایشی الف (فایل)',
          isActive: true,
          isPublic: false,
          maxUploadSizeMb: 5,
          displayOrder: 901,
        },
        {
          id: P5_DEPT_B,
          slug: 'p5test-dept-b',
          nameFa: 'دپارتمان آزمایشی ب (فایل)',
          isActive: true,
          isPublic: false,
          maxUploadSizeMb: 5,
          displayOrder: 902,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(departmentMemberships)
      .values([
        { id: 'p5test_mem_a', departmentId: P5_DEPT_A, userId: P5_USER_A },
        { id: 'p5test_mem_b', departmentId: P5_DEPT_B, userId: P5_USER_B },
        { id: 'p5test_mem_v', departmentId: P5_DEPT_A, userId: P5_USER_VIEW_ONLY },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const driver = getStorageDriver();
    for (const key of createdStorageKeys) {
      await driver.delete(key).catch(() => {});
    }

    // Restore file_hub_policy if modified
    if (hadPolicySettingRow && originalPolicySetting) {
      await saveFileHubPolicy(originalPolicySetting, P5_ADMIN).catch(() => {});
    } else {
      await db
        .delete(systemSettings)
        .where(eq(systemSettings.key, 'file_hub_policy'))
        .catch(() => {});
    }

    // Delete any files/folders in test departments & sync global quota usedBytes
    const filesLeft = await db
      .select({ id: storedFiles.id, storageKey: storedFiles.storageKey })
      .from(storedFiles)
      .where(inArray(storedFiles.departmentId, [P5_DEPT_A, P5_DEPT_B]));
    for (const f of filesLeft) {
      await driver.delete(f.storageKey).catch(() => {});
    }

    await db
      .delete(filePermissions)
      .where(inArray(filePermissions.departmentId, [P5_DEPT_A, P5_DEPT_B]));
    await db
      .delete(storedFiles)
      .where(inArray(storedFiles.departmentId, [P5_DEPT_A, P5_DEPT_B]));
    await db
      .delete(fileFolders)
      .where(inArray(fileFolders.departmentId, [P5_DEPT_A, P5_DEPT_B]));

    await db
      .delete(storageQuotas)
      .where(
        or(
          inArray(storageQuotas.scopeId, [
            P5_DEPT_A,
            P5_DEPT_B,
            P5_USER_A,
            P5_USER_B,
            P5_USER_VIEW_ONLY,
          ]),
          like(storageQuotas.id, 'p5test_%')
        )
      );

    await db
      .delete(auditLogs)
      .where(inArray(auditLogs.actorUserId, [P5_USER_A, P5_USER_B, P5_USER_VIEW_ONLY, P5_ADMIN]));

    await db
      .delete(departmentMemberships)
      .where(inArray(departmentMemberships.departmentId, [P5_DEPT_A, P5_DEPT_B]));
    await db
      .delete(departments)
      .where(inArray(departments.id, [P5_DEPT_A, P5_DEPT_B]));
    await db
      .delete(users)
      .where(inArray(users.id, [P5_USER_A, P5_USER_B, P5_USER_VIEW_ONLY, P5_ADMIN]));

    await pool.end();
  });

  it('creates nested folders, enforces duplicate & cross-department validation, and validates uploads', async () => {
    const accessA = buildFileOperatorAccess(P5_USER_A, [P5_DEPT_A]);
    const viewOnlyA = buildFileOperatorAccess(P5_USER_VIEW_ONLY, [P5_DEPT_A], {
      canUpload: false,
    });

    // View-only operator cannot create folders
    await expect(
      createFolder(viewOnlyA, {
        departmentId: P5_DEPT_A,
        name: 'پوشه غیرمجاز',
      })
    ).rejects.toMatchObject({ status: 403 });

    // Create parent + child folder in Dept A
    const rootFolder = await createFolder(accessA, {
      departmentId: P5_DEPT_A,
      name: 'اسناد مالی ۱۴۰۵',
      ownerLabel: 'پشتیبانی مالی',
      accessPolicy: 'department_only',
    });

    const childFolder = await createFolder(accessA, {
      departmentId: P5_DEPT_A,
      parentFolderId: rootFolder.id,
      name: 'بایگانی فروردین',
      accessPolicy: 'department_only',
    });
    expect(childFolder.parentFolderId).toBe(rootFolder.id);

    // Duplicate folder name under same parent rejected (409)
    await expect(
      createFolder(accessA, {
        departmentId: P5_DEPT_A,
        parentFolderId: rootFolder.id,
        name: 'بایگانی فروردین',
      })
    ).rejects.toMatchObject({ status: 409 });

    // Spoofed executable (.png with MZ header) and unsupported extension (.exe) rejected
    await expect(
      uploadSharedFile(accessA, {
        departmentId: P5_DEPT_A,
        folderId: childFolder.id,
        filename: 'payload.png',
        buffer: MZ_SPOOFED_PNG,
      })
    ).rejects.toThrow('INVALID_FILE_SIGNATURE');

    await expect(
      uploadSharedFile(accessA, {
        departmentId: P5_DEPT_A,
        folderId: childFolder.id,
        filename: 'installer.exe',
        buffer: MZ_SPOOFED_PNG,
      })
    ).rejects.toThrow('UNSUPPORTED_FILE_TYPE');

    // Valid PNG upload succeeds outside web root
    const uploaded = await uploadSharedFile(accessA, {
      departmentId: P5_DEPT_A,
      folderId: childFolder.id,
      title: 'رسید نمونه',
      filename: '../../etc/receipt.png',
      buffer: VALID_PNG_BYTES,
    });
    createdStorageKeys.push(uploaded.storageKey);

    expect(uploaded.storageKey.startsWith(`files/${P5_DEPT_A}/`)).toBe(true);
    expect(uploaded.originalFilename).toBe('receipt.png');
    expect(uploaded.versionNumber).toBe(1);
    expect(await getStorageDriver().exists(uploaded.storageKey)).toBe(true);

    // Cleanup this folder subtree and verify storage key removed
    const delSummary = await deleteFolder(accessA, rootFolder.id);
    expect(delSummary.deletedFileCount).toBe(1);
    expect(await getStorageDriver().exists(uploaded.storageKey)).toBe(false);
  });

  it('enforces cross-department read/download isolation vs shared read-only visibility and explicit permission grants', async () => {
    const accessA = buildFileOperatorAccess(P5_USER_A, [P5_DEPT_A]);
    const accessB = buildFileOperatorAccess(P5_USER_B, [P5_DEPT_B]);
    const adminAccess = buildFileOperatorAccess(P5_ADMIN, [], { isSuperAdmin: true });

    const privateFolder = await createFolder(accessA, {
      departmentId: P5_DEPT_A,
      name: 'پوشه محرمانه الف',
      accessPolicy: 'department_only',
    });

    const privateFile = await uploadSharedFile(accessA, {
      departmentId: P5_DEPT_A,
      folderId: privateFolder.id,
      title: 'گزارش محرمانه دپارتمان الف',
      filename: 'secret.pdf',
      buffer: VALID_PDF_BYTES,
      accessPolicy: 'inherit',
    });
    createdStorageKeys.push(privateFile.storageKey);

    const sharedFolder = await createFolder(accessA, {
      departmentId: P5_DEPT_A,
      name: 'بخشنامه‌های عمومی',
      accessPolicy: 'shared_read_all_departments',
    });

    const sharedFile = await uploadSharedFile(accessA, {
      departmentId: P5_DEPT_A,
      folderId: sharedFolder.id,
      title: 'آیین‌نامه مشترک سازمان',
      filename: 'guideline.pdf',
      buffer: VALID_PDF_BYTES,
      accessPolicy: 'inherit',
    });
    createdStorageKeys.push(sharedFile.storageKey);

    // 1. Operator B CANNOT view or download Dept A's department_only file by guessing ID
    await expect(getFileDetailWithVersions(accessB, privateFile.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(downloadSharedFile(accessB, privateFile.id)).rejects.toMatchObject({
      status: 403,
    });

    // Nonexistent ID returns 404
    await expect(
      downloadSharedFile(accessB, '00000000-0000-0000-0000-000000000000')
    ).rejects.toMatchObject({ status: 404 });

    // 2. Operator B CAN see shared folder/file in Dept A and download it
    const wsB = await listFileHubWorkspace(accessB, {
      departmentId: P5_DEPT_A,
      folderId: sharedFolder.id,
    });
    expect(wsB.files.map((f) => f.id)).toEqual([sharedFile.id]);
    expect(wsB.files[0]?.canDownload).toBe(true);
    expect(wsB.files[0]?.canManage).toBe(false);

    const downloadedShared = await downloadSharedFile(accessB, sharedFile.id);
    expect(downloadedShared.buffer.equals(VALID_PDF_BYTES)).toBe(true);

    // 3. Operator B STILL CANNOT edit, move, replace, or delete Dept A's shared file or folder
    await expect(
      updateSharedFileMetadata(accessB, sharedFile.id, { title: 'تغییر غیرمجاز' })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      replaceSharedFile(accessB, sharedFile.id, {
        filename: 'hack.pdf',
        buffer: VALID_PDF_BYTES,
      })
    ).rejects.toMatchObject({ status: 403 });
    await expect(deleteSharedFile(accessB, sharedFile.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      updateFolder(accessB, sharedFolder.id, { name: 'تغییر نام غیرمجاز' })
    ).rejects.toMatchObject({ status: 403 });

    // 4. Super Admin grants explicit file_permissions exception for Operator B on privateFile
    const grant = await grantFilePermissionAdmin(adminAccess, {
      departmentId: P5_DEPT_A,
      fileId: privateFile.id,
      targetType: 'user',
      targetId: P5_USER_B,
      canView: true,
      canDownload: true,
      canUpload: false,
      canManage: false,
      note: 'استثنای حسابرسی آزمایشی',
    });

    const dlWithGrant = await downloadSharedFile(accessB, privateFile.id);
    expect(dlWithGrant.buffer.equals(VALID_PDF_BYTES)).toBe(true);

    // Revoke exception -> immediately blocked again (403)
    await revokeFilePermissionAdmin(adminAccess, grant.id);
    await expect(downloadSharedFile(accessB, privateFile.id)).rejects.toMatchObject({
      status: 403,
    });

    await deleteFolder(accessA, privateFolder.id);
    await deleteFolder(accessA, sharedFolder.id);
  });

  it('tracks file versions on safe replacement, enforces atomic department/operator quotas, and refunds bytes on deletion', async () => {
    const accessA = buildFileOperatorAccess(P5_USER_A, [P5_DEPT_A]);
    const adminAccess = buildFileOperatorAccess(P5_ADMIN, [], { isSuperAdmin: true });

    // Set tight department quota (1 MB) and tight operator quota? Wait: test byte-level enforcement cleanly:
    // Note upsertQuotaSchema allows min 1 MB; we can upload two 600KB text files concurrently against 1 MB!
    await updateStorageQuotaAdmin(adminAccess, {
      scopeType: 'department',
      scopeId: P5_DEPT_A,
      maxMb: 1,
    });

    const v1Buffer = Buffer.from('A'.repeat(400 * 1024), 'utf8'); // 400 KB
    const v2Buffer = Buffer.from('B'.repeat(400 * 1024), 'utf8'); // 400 KB (total 800 KB <= 1 MB)
    const overflowBuffer = Buffer.from('C'.repeat(350 * 1024), 'utf8'); // +350 KB => 1150 KB > 1 MB!

    const created = await uploadSharedFile(accessA, {
      departmentId: P5_DEPT_A,
      title: 'مستند حجیم آزمایشی',
      filename: 'spec.txt',
      buffer: v1Buffer,
    });
    createdStorageKeys.push(created.storageKey);

    // Safe replacement archives v1 and advances to v2 (800 KB total used)
    const replaced = await replaceSharedFile(accessA, created.id, {
      filename: 'spec-v2.txt',
      buffer: v2Buffer,
      changeNote: 'اصلاحیه نسخه دوم',
    });
    createdStorageKeys.push(replaced.storageKey);
    expect(replaced.versionNumber).toBe(2);

    const detail = await getFileDetailWithVersions(accessA, created.id);
    expect(detail.versions.length).toBe(1);
    expect(detail.versions[0]?.versionNumber).toBe(1);

    // Downloading archived version 1 still returns original v1 content
    const dlV1 = await downloadSharedFile(accessA, created.id, 1);
    expect(dlV1.buffer.equals(v1Buffer)).toBe(true);

    // Concurrent uploads competing for remaining ~224 KB against 1 MB cap must fail with 413 QUOTA_EXCEEDED
    const concurrentResults = await Promise.allSettled([
      uploadSharedFile(accessA, {
        departmentId: P5_DEPT_A,
        filename: 'over1.txt',
        buffer: overflowBuffer,
      }),
      uploadSharedFile(accessA, {
        departmentId: P5_DEPT_A,
        filename: 'over2.txt',
        buffer: overflowBuffer,
      }),
    ]);

    for (const r of concurrentResults) {
      expect(r.status).toBe('rejected');
      if (r.status === 'rejected') {
        expect(r.reason).toMatchObject({ status: 413, code: 'QUOTA_EXCEEDED' });
      }
    }

    // Deleting file removes both versions from disk and frees all 800 KB quota
    const deleted = await deleteSharedFile(accessA, created.id);
    expect(deleted.freedBytes).toBe(v1Buffer.byteLength + v2Buffer.byteLength);
    expect(await getStorageDriver().exists(created.storageKey)).toBe(false);
    expect(await getStorageDriver().exists(replaced.storageKey)).toBe(false);

    // Now overflowBuffer (350 KB) succeeds because quota was refunded!
    const afterRefund = await uploadSharedFile(accessA, {
      departmentId: P5_DEPT_A,
      filename: 'after-refund.txt',
      buffer: overflowBuffer,
    });
    createdStorageKeys.push(afterRefund.storageKey);
    await deleteSharedFile(accessA, afterRefund.id);

    // Verify storage admin overview & policy update + audit trail
    const updatedPolicy = await updateFileHubPolicyAdmin(adminAccess, {
      allowedExtensions: ['pdf', 'txt'],
      maxUploadSizeMb: 2,
    });
    expect(updatedPolicy.allowedExtensions).toEqual(['pdf', 'txt']);

    // PNG is now blocked by policy
    await expect(
      uploadSharedFile(accessA, {
        departmentId: P5_DEPT_A,
        filename: 'blocked-by-policy.png',
        buffer: VALID_PNG_BYTES,
      })
    ).rejects.toThrow('UNSUPPORTED_FILE_TYPE');

    const overview = await getStorageAdminOverview(adminAccess);
    expect(overview.storageHealth.writable).toBe(true);
    expect(
      overview.recentAudit.some((a) => a.action === 'files.item.uploaded')
    ).toBe(true);
    expect(
      overview.recentAudit.some((a) => a.action === 'files.item.replaced')
    ).toBe(true);
    expect(
      overview.recentAudit.some((a) => a.action === 'files.item.downloaded')
    ).toBe(true);
    expect(
      overview.recentAudit.some((a) => a.action === 'files.item.deleted')
    ).toBe(true);
    expect(
      overview.recentAudit.some((a) => a.action === 'admin.storage.quota_updated')
    ).toBe(true);
  });
});
