'use client';

import { useState } from 'react';
import {
  ChevronLeft,
  Download,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  History,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBytesFa, formatJalaliDateTime, toPersianDigits } from '@/src/lib/jalali';

export interface WorkspaceDepartmentItem {
  id: string;
  slug: string;
  nameFa: string;
  isMember: boolean;
  canUpload: boolean;
  effectiveMaxUploadMb: number;
}

export interface WorkspaceFolderItem {
  id: string;
  departmentId: string;
  parentFolderId: string | null;
  name: string;
  description: string;
  ownerLabel: string | null;
  accessPolicy: string;
  canView: boolean;
  canUpload: boolean;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFileItem {
  id: string;
  departmentId: string;
  folderId: string | null;
  folderName: string | null;
  uploadedByUserId: string | null;
  uploaderName: string | null;
  uploaderUsername: string | null;
  title: string;
  description: string;
  originalFilename: string;
  mimeType: string;
  fileExtension: string;
  byteSize: number;
  sha256: string;
  scanStatus: string;
  versionNumber: number;
  accessPolicy: string;
  effectivePolicy: 'department_only' | 'shared_read_all_departments';
  downloadCount: number;
  lastDownloadedAt: string | null;
  canView: boolean;
  canDownload: boolean;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspacePayload {
  departments: WorkspaceDepartmentItem[];
  activeDepartment:
    | (WorkspaceDepartmentItem & { canUploadInCurrentFolder: boolean })
    | null;
  folders: WorkspaceFolderItem[];
  allAccessibleFolders?: Array<{
    id: string;
    name: string;
    parentFolderId: string | null;
    canManage: boolean;
  }>;
  breadcrumbs: Array<{ id: string; name: string }>;
  files: WorkspaceFileItem[];
  policy: {
    allowedExtensions: string[];
    maxUploadSizeMb: number;
  };
  quotas: {
    global: { maxBytes: number; usedBytes: number } | null;
    department: { maxBytes: number; usedBytes: number } | null;
    operator: { maxBytes: number; usedBytes: number } | null;
  };
}

interface FileDetailResponse {
  file: WorkspaceFileItem;
  versions: Array<{
    id: string;
    versionNumber: number;
    originalFilename: string;
    mimeType: string;
    fileExtension: string;
    byteSize: number;
    sha256: string;
    changeNote: string | null;
    replacedByName: string | null;
    createdAt: string;
  }>;
}

function policyLabelFa(policy: string): string {
  if (policy === 'shared_read_all_departments') return 'اشتراکی (مشاهده در کل سازمان)';
  if (policy === 'department_only') return 'اختصاصی دپارتمان';
  return 'ارث‌بری از پوشه';
}

export function SharedFilesWorkspace({
  initialData,
}: {
  initialData: WorkspacePayload;
}) {
  const [data, setData] = useState<WorkspacePayload>(initialData);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [extensionFilter, setExtensionFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // Create / Edit Folder Dialog
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<WorkspaceFolderItem | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderOwnerLabel, setFolderOwnerLabel] = useState('');
  const [folderDescription, setFolderDescription] = useState('');
  const [folderPolicy, setFolderPolicy] = useState<
    'department_only' | 'shared_read_all_departments'
  >('department_only');
  const [savingFolder, setSavingFolder] = useState(false);

  // Delete Folder Confirmation
  const [deletingFolder, setDeletingFolder] = useState<WorkspaceFolderItem | null>(null);
  const [deletingFolderBusy, setDeletingFolderBusy] = useState(false);

  // Upload File Dialog
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadPolicy, setUploadPolicy] = useState<
    'inherit' | 'department_only' | 'shared_read_all_departments'
  >('inherit');
  const [uploading, setUploading] = useState(false);

  // File Detail / Edit / Replace / Versions / Delete Dialog
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<FileDetailResponse | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editFolderId, setEditFolderId] = useState<string>('');
  const [editFilePolicy, setEditFilePolicy] = useState<
    'inherit' | 'department_only' | 'shared_read_all_departments'
  >('inherit');
  const [savingFileMeta, setSavingFileMeta] = useState(false);
  const [replaceFileObj, setReplaceFileObj] = useState<File | null>(null);
  const [replaceNote, setReplaceNote] = useState('');
  const [replacingFile, setReplacingFile] = useState(false);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState(false);
  const [deletingFileBusy, setDeletingFileBusy] = useState(false);

  async function loadWorkspace(opts?: {
    departmentId?: string;
    folderId?: string | null;
    q?: string;
    extension?: string;
  }) {
    const targetDeptId = opts?.departmentId ?? data.activeDepartment?.id;
    const targetFolderId =
      opts && 'folderId' in opts ? opts.folderId ?? null : currentFolderId;
    const targetSearch = opts?.q !== undefined ? opts.q : searchQuery;
    const targetExt =
      opts?.extension !== undefined ? opts.extension : extensionFilter;

    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (targetDeptId) qs.set('departmentId', targetDeptId);
      if (targetFolderId) qs.set('folderId', targetFolderId);
      if (targetSearch.trim()) qs.set('q', targetSearch.trim());
      if (targetExt) qs.set('extension', targetExt);

      const res = await fetch(`/api/workspace/files?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در بارگذاری مخزن فایل.');
        return;
      }
      setData(json);
      setCurrentFolderId(targetFolderId);
    } catch {
      toast.error('ارتباط با سرور برای دریافت فایل‌ها برقرار نشد.');
    } finally {
      setLoading(false);
    }
  }

  function openNewFolderModal() {
    setEditingFolder(null);
    setFolderName('');
    setFolderOwnerLabel('');
    setFolderDescription('');
    setFolderPolicy('department_only');
    setFolderDialogOpen(true);
  }

  function openEditFolderModal(folder: WorkspaceFolderItem) {
    setEditingFolder(folder);
    setFolderName(folder.name);
    setFolderOwnerLabel(folder.ownerLabel || '');
    setFolderDescription(folder.description || '');
    setFolderPolicy(
      folder.accessPolicy === 'shared_read_all_departments'
        ? 'shared_read_all_departments'
        : 'department_only'
    );
    setFolderDialogOpen(true);
  }

  async function handleSaveFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!data.activeDepartment) return;
    setSavingFolder(true);
    try {
      const url = editingFolder
        ? `/api/workspace/files/folders/${editingFolder.id}`
        : '/api/workspace/files/folders';
      const method = editingFolder ? 'PATCH' : 'POST';
      const payload = editingFolder
        ? {
            name: folderName,
            ownerLabel: folderOwnerLabel.trim() || null,
            description: folderDescription,
            accessPolicy: folderPolicy,
          }
        : {
            departmentId: data.activeDepartment.id,
            parentFolderId: currentFolderId,
            name: folderName,
            ownerLabel: folderOwnerLabel.trim() || null,
            description: folderDescription,
            accessPolicy: folderPolicy,
          };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در ذخیره پوشه.');
        return;
      }
      toast.success(editingFolder ? 'پوشه بروزرسانی شد.' : 'پوشه جدید ایجاد شد.');
      setFolderDialogOpen(false);
      await loadWorkspace();
    } catch {
      toast.error('خطای شبکه در ذخیره پوشه.');
    } finally {
      setSavingFolder(false);
    }
  }

  async function handleDeleteFolderConfirm() {
    if (!deletingFolder) return;
    setDeletingFolderBusy(true);
    try {
      const res = await fetch(`/api/workspace/files/folders/${deletingFolder.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در حذف پوشه.');
        return;
      }
      toast.success(
        `پوشه حذف شد (${toPersianDigits(json.deletedFileCount ?? 0)} فایل آزادسازی شد).`
      );
      setDeletingFolder(null);
      await loadWorkspace();
    } catch {
      toast.error('خطای شبکه در حذف پوشه.');
    } finally {
      setDeletingFolderBusy(false);
    }
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data.activeDepartment || !uploadFile) {
      toast.error('لطفاً یک فایل انتخاب کنید.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', uploadFile);
      form.append('departmentId', data.activeDepartment.id);
      if (currentFolderId) form.append('folderId', currentFolderId);
      if (uploadTitle.trim()) form.append('title', uploadTitle.trim());
      if (uploadDescription.trim()) form.append('description', uploadDescription.trim());
      form.append('accessPolicy', uploadPolicy);

      const res = await fetch('/api/workspace/files/upload', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در بارگذاری فایل.');
        return;
      }
      toast.success('فایل با موفقیت ذخیره شد.');
      setUploadDialogOpen(false);
      setUploadFile(null);
      setUploadTitle('');
      setUploadDescription('');
      setUploadPolicy('inherit');
      await loadWorkspace();
    } catch {
      toast.error('خطای شبکه در بارگذاری فایل.');
    } finally {
      setUploading(false);
    }
  }

  async function openFileDetails(file: WorkspaceFileItem) {
    setDetailOpen(true);
    setDetailLoading(true);
    setConfirmDeleteFile(false);
    setReplaceFileObj(null);
    setReplaceNote('');
    setDetailData(null);

    try {
      const res = await fetch(`/api/workspace/files/items/${file.id}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در دریافت جزئیات فایل.');
        setDetailOpen(false);
        return;
      }
      setDetailData(json);
      setEditTitle(json.file.title);
      setEditDescription(json.file.description || '');
      setEditFolderId(json.file.folderId || '');
      setEditFilePolicy(
        json.file.accessPolicy === 'department_only' ||
          json.file.accessPolicy === 'shared_read_all_departments'
          ? json.file.accessPolicy
          : 'inherit'
      );
    } catch {
      toast.error('خطای شبکه در دریافت جزئیات فایل.');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSaveFileMetadata(e: React.FormEvent) {
    e.preventDefault();
    if (!detailData) return;
    setSavingFileMeta(true);
    try {
      const res = await fetch(`/api/workspace/files/items/${detailData.file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          folderId: editFolderId || null,
          accessPolicy: editFilePolicy,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در ویرایش مشخصات فایل.');
        return;
      }
      toast.success('مشخصات فایل ذخیره شد.');
      await openFileDetails(detailData.file);
      await loadWorkspace();
    } catch {
      toast.error('خطای شبکه در ویرایش فایل.');
    } finally {
      setSavingFileMeta(false);
    }
  }

  async function handleReplaceFileSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!detailData || !replaceFileObj) {
      toast.error('لطفاً فایل نسخه جدید را انتخاب کنید.');
      return;
    }
    setReplacingFile(true);
    try {
      const form = new FormData();
      form.append('file', replaceFileObj);
      if (replaceNote.trim()) form.append('changeNote', replaceNote.trim());

      const res = await fetch(
        `/api/workspace/files/items/${detailData.file.id}/replace`,
        {
          method: 'POST',
          body: form,
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در جایگزینی نسخه فایل.');
        return;
      }
      toast.success(
        `نسخه جدید (${toPersianDigits(json.file.versionNumber)}) بارگذاری شد.`
      );
      setReplaceFileObj(null);
      setReplaceNote('');
      await openFileDetails(detailData.file);
      await loadWorkspace();
    } catch {
      toast.error('خطای شبکه در جایگزینی فایل.');
    } finally {
      setReplacingFile(false);
    }
  }

  async function handleDeleteFileConfirm() {
    if (!detailData) return;
    setDeletingFileBusy(true);
    try {
      const res = await fetch(`/api/workspace/files/items/${detailData.file.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در حذف فایل.');
        return;
      }
      toast.success('فایل و تاریخچه نسخه‌های آن حذف و ظرفیت آزاد شد.');
      setDetailOpen(false);
      await loadWorkspace();
    } catch {
      toast.error('خطای شبکه در حذف فایل.');
    } finally {
      setDeletingFileBusy(false);
    }
  }

  const activeDept = data.activeDepartment;
  const activeQuota = data.quotas.department || data.quotas.operator || data.quotas.global;
  const quotaPct = activeQuota && activeQuota.maxBytes > 0
    ? Math.min(100, Math.round((activeQuota.usedBytes / activeQuota.maxBytes) * 100))
    : 0;

  return (
    <div className="space-y-6">
      {/* Header & Quota Strip */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">مخزن فایل اشتراکی</h1>
          <p className="text-sm text-slate-600">
            کتابخانه اسناد و فایل‌های سازمانی با تفکیک دپارتمان، پوشه‌بندی و کنترل دسترسی
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadWorkspace()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span>بروزرسانی</span>
          </Button>

          {activeDept?.canUploadInCurrentFolder && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openNewFolderModal}
              >
                <FolderPlus className="h-4 w-4" />
                <span>پوشه جدید</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setUploadDialogOpen(true)}
              >
                <Upload className="h-4 w-4" />
                <span>بارگذاری فایل</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Department Area Switcher */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          {data.departments.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              هیچ فضای دپارتمانی یا فایل اشتراکی برای حساب کاربری شما تعریف نشده است.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {data.departments.map((dept) => {
                const isSelected = dept.id === activeDept?.id;
                return (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setExtensionFilter('');
                      void loadWorkspace({
                        departmentId: dept.id,
                        folderId: null,
                        q: '',
                        extension: '',
                      });
                    }}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-blue-700 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    <span>{dept.nameFa}</span>
                    {!dept.canUpload && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        فقط مشاهده
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Quota Summary */}
          {activeDept && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-100 text-xs">
              <div className="rounded-lg bg-slate-50 border border-slate-200/70 p-3 flex items-center justify-between">
                <span className="text-slate-600 flex items-center gap-1.5">
                  <HardDrive className="h-4 w-4 text-blue-700" />
                  <span>
                    {data.quotas.department
                      ? 'سهمیه دپارتمان فعال'
                      : data.quotas.operator
                        ? 'سهمیه فردی شما'
                        : 'سهمیه کل سازمان'}
                  </span>
                </span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {activeQuota
                    ? `${formatBytesFa(activeQuota.usedBytes)} / ${formatBytesFa(
                        activeQuota.maxBytes
                      )} (${toPersianDigits(quotaPct)}٪)`
                    : '—'}
                </span>
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200/70 p-3 flex items-center justify-between">
                <span className="text-slate-600">حداکثر حجم هر فایل</span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {toPersianDigits(activeDept.effectiveMaxUploadMb)} مگابایت
                </span>
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200/70 p-3 flex items-center justify-between gap-2">
                <span className="text-slate-600 shrink-0">پسوندهای مجاز</span>
                <span
                  dir="ltr"
                  className="font-[family-name:var(--font-mono)] text-[11px] text-slate-700 truncate"
                >
                  {data.policy.allowedExtensions.join(', ')}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Browser Card */}
      {activeDept && (
        <Card>
          <CardHeader className="border-b border-slate-100 pb-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Breadcrumbs */}
              <nav
                aria-label="مسیر پوشه‌ها"
                className="flex flex-wrap items-center gap-1.5 text-sm"
              >
                <button
                  type="button"
                  onClick={() => void loadWorkspace({ folderId: null })}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    currentFolderId === null
                      ? 'bg-blue-50 text-blue-800'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {activeDept.nameFa}
                </button>
                {data.breadcrumbs.map((crumb) => (
                  <div key={crumb.id} className="flex items-center gap-1">
                    <ChevronLeft className="h-3.5 w-3.5 text-slate-400" />
                    <button
                      type="button"
                      onClick={() => void loadWorkspace({ folderId: crumb.id })}
                      className={`rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
                        currentFolderId === crumb.id
                          ? 'bg-blue-50 text-blue-800'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </div>
                ))}
              </nav>

              {/* Search & Filter */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadWorkspace({
                    q: searchQuery,
                    extension: extensionFilter,
                  });
                }}
                className="flex flex-wrap items-center gap-2 w-full md:w-auto"
              >
                <div className="relative flex-1 sm:flex-initial">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="جستجوی نام فایل یا پوشه..."
                    className="h-9 pr-8 w-full sm:w-52 text-xs"
                  />
                </div>
                <select
                  value={extensionFilter}
                  onChange={(e) => {
                    const nextExt = e.target.value;
                    setExtensionFilter(nextExt);
                    void loadWorkspace({ extension: nextExt });
                  }}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">همه فرمت‌ها</option>
                  {data.policy.allowedExtensions.map((ext) => (
                    <option key={ext} value={ext}>
                      {ext.toUpperCase()}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm" className="h-9 text-xs">
                  جستجو
                </Button>
              </form>
            </div>
          </CardHeader>

          <CardContent className="pt-5 space-y-6">
            {/* Subfolders Grid */}
            {data.folders.length > 0 && (
              <div className="space-y-2.5">
                <h2 className="text-xs font-semibold text-slate-500">پوشه‌ها</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.folders.map((folder) => (
                    <div
                      key={folder.id}
                      className="group rounded-xl border border-slate-200 bg-white p-3.5 hover:border-blue-300 transition-colors flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => void loadWorkspace({ folderId: folder.id })}
                          className="flex items-start gap-2.5 text-right flex-1 min-w-0 cursor-pointer"
                        >
                          <Folder className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {folder.name}
                            </div>
                            {folder.ownerLabel && (
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                مسئول: {folder.ownerLabel}
                              </div>
                            )}
                            {folder.description && (
                              <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                                {folder.description}
                              </div>
                            )}
                          </div>
                        </button>

                        {folder.canManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              title="ویرایش پوشه"
                              onClick={() => openEditFolderModal(folder)}
                              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="حذف پوشه"
                              onClick={() => setDeletingFolder(folder)}
                              className="p-1.5 rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                        <span className="flex items-center gap-1">
                          {folder.accessPolicy === 'shared_read_all_departments' ? (
                            <>
                              <Share2 className="h-3 w-3 text-emerald-700" />
                              <span className="text-emerald-800">اشتراکی کل سازمان</span>
                            </>
                          ) : (
                            <>
                              <Lock className="h-3 w-3 text-slate-500" />
                              <span>اختصاصی دپارتمان</span>
                            </>
                          )}
                        </span>
                        <span className="tabular-nums">
                          {formatJalaliDateTime(folder.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Files Table */}
            <div className="space-y-2.5">
              <h2 className="text-xs font-semibold text-slate-500">فایل‌ها</h2>

              {data.files.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center space-y-2">
                  <FileText className="h-8 w-8 text-slate-300 mx-auto" />
                  <p className="text-sm text-slate-500">
                    در این مسیر فایلی مطابق فیلتر فعلی یافت نشد.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm text-right border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                      <tr>
                        <th className="py-3 px-4 font-medium">نام و عنوان فایل</th>
                        <th className="py-3 px-3 font-medium">حجم / نسخه</th>
                        <th className="py-3 px-3 font-medium">بارگذاری‌کننده</th>
                        <th className="py-3 px-3 font-medium">سیاست دسترسی</th>
                        <th className="py-3 px-3 font-medium">تاریخ بارگذاری</th>
                        <th className="py-3 px-4 font-medium text-left">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {data.files.map((file) => (
                        <tr key={file.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">
                              {file.title}
                            </div>
                            <div
                              dir="ltr"
                              className="text-[11px] text-slate-500 font-[family-name:var(--font-mono)] text-right truncate max-w-xs"
                            >
                              {file.originalFilename}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-700 tabular-nums whitespace-nowrap">
                            <div>{formatBytesFa(file.byteSize)}</div>
                            <div className="text-[11px] text-slate-500">
                              نسخه {toPersianDigits(file.versionNumber)} ·{' '}
                              {toPersianDigits(file.downloadCount)} دریافت
                            </div>
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-700">
                            {file.uploaderName || 'سیستم'}
                          </td>
                          <td className="py-3 px-3 text-xs">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                file.effectivePolicy === 'shared_read_all_departments'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {file.effectivePolicy === 'shared_read_all_departments'
                                ? 'اشتراکی کل سازمان'
                                : 'اختصاصی دپارتمان'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                            {formatJalaliDateTime(file.createdAt)}
                          </td>
                          <td className="py-3 px-4 text-left whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {file.canDownload && (
                                <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                                  <a href={`/api/workspace/files/items/${file.id}/download`}>
                                    <Download className="h-3.5 w-3.5" />
                                    <span>دریافت</span>
                                  </a>
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => void openFileDetails(file)}
                              >
                                <History className="h-3.5 w-3.5" />
                                <span>جزئیات</span>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create / Edit Folder Dialog */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingFolder ? 'ویرایش پوشه' : 'ایجاد پوشه جدید'}
            </DialogTitle>
            <DialogDescription>
              ساختار پوشه برای نظم‌دهی فایل‌های دپارتمان و تعیین سطح اشتراک‌گذاری
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleSaveFolder(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="folder-name">نام پوشه</Label>
              <Input
                id="folder-name"
                required
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="مثلاً: دستورالعمل‌های اجرایی یا پوشه اپراتور"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="folder-owner">برچسب مسئول / مالک پوشه (اختیاری)</Label>
              <Input
                id="folder-owner"
                value={folderOwnerLabel}
                onChange={(e) => setFolderOwnerLabel(e.target.value)}
                placeholder="مثلاً: واحد مالی یا نام اپراتور"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="folder-policy">سیاست دسترسی</Label>
              <select
                id="folder-policy"
                value={folderPolicy}
                onChange={(e) =>
                  setFolderPolicy(
                    e.target.value as 'department_only' | 'shared_read_all_departments'
                  )
                }
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="department_only">
                  اختصاصی دپارتمان (فقط اعضای مجاز این دپارتمان)
                </option>
                <option value="shared_read_all_departments">
                  اشتراکی (مشاهده و دانلود فقط‌خواندنی برای اپراتورهای سایر دپارتمان‌ها)
                </option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="folder-desc">توضیحات</Label>
              <Input
                id="folder-desc"
                value={folderDescription}
                onChange={(e) => setFolderDescription(e.target.value)}
                placeholder="توضیح کوتاه درباره محتوای این پوشه"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFolderDialogOpen(false)}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={savingFolder}>
                {savingFolder && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{editingFolder ? 'ذخیره تغییرات' : 'ایجاد پوشه'}</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation Dialog */}
      <Dialog
        open={Boolean(deletingFolder)}
        onOpenChange={(open) => {
          if (!open) setDeletingFolder(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-700">تایید حذف پوشه</DialogTitle>
            <DialogDescription>
              آیا از حذف پوشه «{deletingFolder?.name}» اطمینان دارید؟ تمام زیرپوشه‌ها،
              فایل‌ها و تاریخچه نسخه‌های داخل آن حذف شده و سهمیه حجمی آزاد می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingFolder(null)}
            >
              انصراف
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingFolderBusy}
              onClick={() => void handleDeleteFolderConfirm()}
            >
              {deletingFolderBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>حذف قطعی پوشه</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload File Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>بارگذاری فایل جدید در مخزن</DialogTitle>
            <DialogDescription>
              فایل پس از بررسی امضای محتوا، حجم و سهمیه در فضای پایدار ذخیره می‌شود.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleUploadSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="upload-file-input">انتخاب فایل</Label>
              <Input
                id="upload-file-input"
                type="file"
                required
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setUploadFile(f);
                  if (f && !uploadTitle.trim()) {
                    setUploadTitle(f.name);
                  }
                }}
              />
              {activeDept && (
                <p className="text-[11px] text-slate-500">
                  سقف مجاز: {toPersianDigits(activeDept.effectiveMaxUploadMb)} مگابایت ·{' '}
                  پسوندها: {data.policy.allowedExtensions.join(', ')}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upload-title">عنوان نمایشی فایل</Label>
              <Input
                id="upload-title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="عنوان فایل در کتابخانه"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upload-policy">سیاست دسترسی فایل</Label>
              <select
                id="upload-policy"
                value={uploadPolicy}
                onChange={(e) =>
                  setUploadPolicy(
                    e.target.value as
                      | 'inherit'
                      | 'department_only'
                      | 'shared_read_all_departments'
                  )
                }
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="inherit">ارث‌بری از سیاست پوشه (پیش‌فرض)</option>
                <option value="department_only">اختصاصی دپارتمان</option>
                <option value="shared_read_all_departments">
                  اشتراکی (مشاهده و دانلود برای کل سازمان)
                </option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upload-desc">توضیحات</Label>
              <Input
                id="upload-desc"
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                placeholder="شرح کوتاه کاربرد فایل"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadDialogOpen(false)}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={uploading || !uploadFile}>
                {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>بارگذاری فایل</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* File Details / Edit / Replace / Versions / Delete Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>جزئیات و مدیریت فایل</DialogTitle>
            <DialogDescription>
              اطلاعات فنی، تاریخچه نسخه‌ها، ویرایش فراداده و جایگزینی امن فایل
            </DialogDescription>
          </DialogHeader>

          {detailLoading || !detailData ? (
            <div className="py-10 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>در حال بارگذاری جزئیات...</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Metadata Summary */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500">نام اصلی: </span>
                  <span
                    dir="ltr"
                    className="font-[family-name:var(--font-mono)] font-medium text-slate-800"
                  >
                    {detailData.file.originalFilename}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">حجم فعلی: </span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {formatBytesFa(detailData.file.byteSize)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">نسخه فعلی: </span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {toPersianDigits(detailData.file.versionNumber)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">بارگذاری توسط: </span>
                  <span className="font-medium text-slate-800">
                    {detailData.file.uploaderName || 'سیستم'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">سیاست دسترسی: </span>
                  <span className="font-medium text-slate-800">
                    {policyLabelFa(detailData.file.accessPolicy)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">تعداد دانلود: </span>
                  <span className="font-medium text-slate-800 tabular-nums">
                    {toPersianDigits(detailData.file.downloadCount)}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-500">چک‌سام SHA-256: </span>
                  <span
                    dir="ltr"
                    className="font-[family-name:var(--font-mono)] text-[11px] text-slate-700 break-all"
                  >
                    {detailData.file.sha256}
                  </span>
                </div>
              </div>

              {/* Edit Metadata & Move Folder (Only when canManage is true) */}
              {detailData.file.canManage && (
                <form
                  onSubmit={(e) => void handleSaveFileMetadata(e)}
                  className="space-y-3 rounded-xl border border-slate-200 p-4"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    ویرایش مشخصات و جابه‌جایی پوشه
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="edit-file-title">عنوان</Label>
                      <Input
                        id="edit-file-title"
                        required
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-file-folder">پوشه مقصد</Label>
                      <select
                        id="edit-file-folder"
                        value={editFolderId}
                        onChange={(e) => setEditFolderId(e.target.value)}
                        className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="">ریشه دپارتمان</option>
                        {(data.allAccessibleFolders || []).map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="edit-file-policy">سیاست دسترسی</Label>
                      <select
                        id="edit-file-policy"
                        value={editFilePolicy}
                        onChange={(e) =>
                          setEditFilePolicy(
                            e.target.value as
                              | 'inherit'
                              | 'department_only'
                              | 'shared_read_all_departments'
                          )
                        }
                        className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="inherit">ارث‌بری از پوشه</option>
                        <option value="department_only">اختصاصی دپارتمان</option>
                        <option value="shared_read_all_departments">
                          اشتراکی کل سازمان
                        </option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-file-desc">توضیحات</Label>
                      <Input
                        id="edit-file-desc"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={savingFileMeta}>
                      {savingFileMeta && <Loader2 className="h-4 w-4 animate-spin" />}
                      <span>ذخیره تغییرات</span>
                    </Button>
                  </div>
                </form>
              )}

              {/* Safe Version Replacement */}
              {detailData.file.canManage && (
                <form
                  onSubmit={(e) => void handleReplaceFileSubmit(e)}
                  className="space-y-3 rounded-xl border border-slate-200 p-4"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    جایگزینی و ثبت نسخه جدید
                  </h3>
                  <p className="text-xs text-slate-500">
                    نسخه فعلی در تاریخچه نسخه‌ها آرشیو می‌شود و نسخه جدید جایگزین آن
                    خواهد شد.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="replace-file-input">فایل نسخه جدید</Label>
                      <Input
                        id="replace-file-input"
                        type="file"
                        onChange={(e) =>
                          setReplaceFileObj(e.target.files?.[0] || null)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="replace-note">توضیح تغییرات (اختیاری)</Label>
                      <Input
                        id="replace-note"
                        value={replaceNote}
                        onChange={(e) => setReplaceNote(e.target.value)}
                        placeholder="مثلاً: اصلاح بند سوم آیین‌نامه"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={replacingFile || !replaceFileObj}
                    >
                      {replacingFile && <Loader2 className="h-4 w-4 animate-spin" />}
                      <span>ثبت نسخه جدید</span>
                    </Button>
                  </div>
                </form>
              )}

              {/* Version History */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  تاریخچه نسخه‌های قبلی
                </h3>
                {detailData.versions.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    هنوز نسخه جایگزینی برای این فایل ثبت نشده است.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {detailData.versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="p-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-800">
                            نسخه {toPersianDigits(ver.versionNumber)} ·{' '}
                            {ver.originalFilename}
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            {formatBytesFa(ver.byteSize)} ·{' '}
                            {formatJalaliDateTime(ver.createdAt)}
                            {ver.changeNote ? ` · ${ver.changeNote}` : ''}
                          </div>
                        </div>
                        {detailData.file.canDownload && (
                          <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                            <a
                              href={`/api/workspace/files/items/${detailData.file.id}/download?version=${ver.versionNumber}`}
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span>دریافت</span>
                            </a>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Delete Action */}
              {detailData.file.canManage && (
                <div className="border-t border-slate-200 pt-4 flex items-center justify-between gap-3">
                  {confirmDeleteFile ? (
                    <div className="flex items-center gap-2 w-full justify-between bg-red-50 border border-red-200 rounded-lg p-3">
                      <span className="text-xs text-red-800 font-medium">
                        فایل و تمام نسخه‌های آن برای همیشه حذف شوند؟
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmDeleteFile(false)}
                        >
                          انصراف
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={deletingFileBusy}
                          onClick={() => void handleDeleteFileConfirm()}
                        >
                          {deletingFileBusy && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          <span>تایید حذف</span>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmDeleteFile(true)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>حذف فایل</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDetailOpen(false)}
                      >
                        بستن
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
