import { and, eq, inArray, or } from 'drizzle-orm';
import { hasPermission, type UserAccessProfile } from '@/src/core/auth/rbac.ts';
import { db } from '@/src/db/index.ts';
import { filePermissions } from '@/src/db/schema.ts';

export type EffectiveAccessPolicy =
  | 'department_only'
  | 'shared_read_all_departments';

export interface FilePermissionGrantRow {
  id: string;
  departmentId: string;
  folderId: string | null;
  fileId: string | null;
  targetType: string;
  targetId: string;
  canView: boolean;
  canDownload: boolean;
  canUpload: boolean;
  canManage: boolean;
}

export function hasGlobalFileManage(access: UserAccessProfile): boolean {
  return access.isSuperAdmin || hasPermission(access, 'files:items:manage_all');
}

export function isDepartmentMemberForFiles(
  access: UserAccessProfile,
  departmentId: string
): boolean {
  return access.departments.some((d) => d.departmentId === departmentId);
}

export function resolveEffectiveFilePolicy(
  filePolicy: string,
  folderPolicy?: string | null
): EffectiveAccessPolicy {
  if (filePolicy === 'shared_read_all_departments') {
    return 'shared_read_all_departments';
  }
  if (filePolicy === 'department_only') {
    return 'department_only';
  }
  // inherit from folder if present
  if (folderPolicy === 'shared_read_all_departments') {
    return 'shared_read_all_departments';
  }
  return 'department_only';
}

export async function loadMatchingGrantsForUser(
  access: UserAccessProfile,
  departmentId?: string
): Promise<FilePermissionGrantRow[]> {
  if (!access.userId && access.departments.length === 0) {
    return [];
  }

  const targetFilters = [];
  if (access.userId) {
    targetFilters.push(
      and(
        eq(filePermissions.targetType, 'user'),
        eq(filePermissions.targetId, access.userId)
      )
    );
  }
  const deptIds = access.departments.map((d) => d.departmentId);
  if (deptIds.length > 0) {
    targetFilters.push(
      and(
        eq(filePermissions.targetType, 'department'),
        inArray(filePermissions.targetId, deptIds)
      )
    );
  }

  if (targetFilters.length === 0) return [];

  const rows = await db
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
    })
    .from(filePermissions)
    .where(
      departmentId
        ? and(eq(filePermissions.departmentId, departmentId), or(...targetFilters))
        : or(...targetFilters)
    );

  return rows;
}

function findMatchingGrantsForResource(
  grants: FilePermissionGrantRow[],
  params: { departmentId: string; folderId?: string | null; fileId?: string | null }
): FilePermissionGrantRow[] {
  return grants.filter((g) => {
    if (g.departmentId !== params.departmentId) return false;
    // Department-wide grant
    if (!g.folderId && !g.fileId) return true;
    // Folder grant applies to the folder and files directly inside it
    if (g.folderId && params.folderId && g.folderId === params.folderId) return true;
    // File-specific grant
    if (g.fileId && params.fileId && g.fileId === params.fileId) return true;
    return false;
  });
}

export function evaluateFolderAccess(
  access: UserAccessProfile,
  folder: { id: string; departmentId: string; accessPolicy: string },
  grants: FilePermissionGrantRow[]
): {
  canView: boolean;
  canUpload: boolean;
  canManage: boolean;
} {
  if (hasGlobalFileManage(access)) {
    return { canView: true, canUpload: true, canManage: true };
  }

  const hasWorkspaceAndView =
    hasPermission(access, 'files:workspace:access') &&
    hasPermission(access, 'files:items:view');

  const isMember = isDepartmentMemberForFiles(access, folder.departmentId);
  const canUploadPerm = hasPermission(access, 'files:items:upload');

  const matched = findMatchingGrantsForResource(grants, {
    departmentId: folder.departmentId,
    folderId: folder.id,
  });

  const grantView = matched.some((g) => g.canView || g.canDownload || g.canManage);
  const grantUpload = matched.some((g) => g.canUpload || g.canManage);
  const grantManage = matched.some((g) => g.canManage);

  const canView =
    hasWorkspaceAndView &&
    (isMember ||
      folder.accessPolicy === 'shared_read_all_departments' ||
      grantView);

  const canMutate =
    hasPermission(access, 'files:workspace:access') &&
    ((isMember && canUploadPerm) || grantManage);

  const canUpload =
    hasPermission(access, 'files:workspace:access') &&
    ((isMember && canUploadPerm) || grantUpload || grantManage);

  return {
    canView,
    canUpload,
    canManage: canMutate,
  };
}

export function evaluateFileAccess(
  access: UserAccessProfile,
  file: {
    id: string;
    departmentId: string;
    folderId: string | null;
    accessPolicy: string;
  },
  folderAccessPolicy: string | null | undefined,
  grants: FilePermissionGrantRow[]
): {
  canView: boolean;
  canDownload: boolean;
  canManage: boolean;
  effectivePolicy: EffectiveAccessPolicy;
} {
  const effectivePolicy = resolveEffectiveFilePolicy(
    file.accessPolicy,
    folderAccessPolicy
  );

  if (hasGlobalFileManage(access)) {
    return {
      canView: true,
      canDownload: true,
      canManage: true,
      effectivePolicy,
    };
  }

  const hasWorkspaceAndView =
    hasPermission(access, 'files:workspace:access') &&
    hasPermission(access, 'files:items:view');

  const isMember = isDepartmentMemberForFiles(access, file.departmentId);
  const canUploadPerm = hasPermission(access, 'files:items:upload');

  const matched = findMatchingGrantsForResource(grants, {
    departmentId: file.departmentId,
    folderId: file.folderId,
    fileId: file.id,
  });

  const grantView = matched.some((g) => g.canView || g.canManage);
  const grantDownload = matched.some((g) => g.canDownload || g.canManage);
  const grantManage = matched.some((g) => g.canManage);

  const isSharedReadable = effectivePolicy === 'shared_read_all_departments';

  const canView = hasWorkspaceAndView && (isMember || isSharedReadable || grantView);
  const canDownload =
    hasWorkspaceAndView && (isMember || isSharedReadable || grantDownload);

  // Cross-department operators may ONLY view/download shared files; they CANNOT edit/replace/move/delete
  // unless they hold an explicit file_permissions canManage grant or files:items:manage_all.
  const canManage =
    hasPermission(access, 'files:workspace:access') &&
    ((isMember && canUploadPerm) || grantManage);

  return {
    canView,
    canDownload,
    canManage,
    effectivePolicy,
  };
}

export function canUploadToDepartment(
  access: UserAccessProfile,
  departmentId: string,
  folderId: string | null,
  grants: FilePermissionGrantRow[]
): boolean {
  if (hasGlobalFileManage(access)) {
    return true;
  }
  if (!hasPermission(access, 'files:workspace:access')) {
    return false;
  }
  const isMember = isDepartmentMemberForFiles(access, departmentId);
  if (isMember && hasPermission(access, 'files:items:upload')) {
    return true;
  }
  const matched = findMatchingGrantsForResource(grants, {
    departmentId,
    folderId,
  });
  return matched.some((g) => g.canUpload || g.canManage);
}
