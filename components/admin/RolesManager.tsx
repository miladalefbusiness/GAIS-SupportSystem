'use client';

import { useMemo, useState } from 'react';
import { Check, Loader2, Lock, Plus, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
import { toPersianDigits } from '@/src/lib/jalali';

export interface AdminRoleItem {
  id: string;
  slug: string;
  nameFa: string;
  descriptionFa: string;
  isSystem: boolean;
  permissionIds: string[];
}

export interface AdminPermissionItem {
  id: string;
  key: string;
  module: string;
  nameFa: string;
  descriptionFa: string;
}

const PROTECTED_SUPERADMIN_KEYS = new Set([
  'admin:panel:access',
  'admin:roles:manage',
  'admin:users:manage',
  'admin:departments:manage',
]);

const MODULE_LABELS: Record<string, string> = {
  support_desk: 'میز پشتیبانی',
  shared_files: 'مخزن فایل اشتراکی',
  knowledge_base: 'مخزن دانش',
  ai_settings: 'تنظیمات هوش مصنوعی',
  administration: 'مدیریت سامانه',
};

export function RolesManager({
  initialRoles,
  permissions,
}: {
  initialRoles: AdminRoleItem[];
  permissions: AdminPermissionItem[];
}) {
  const router = useRouter();
  const [roles, setRoles] = useState<AdminRoleItem[]>(initialRoles);
  const [selectedRoleId, setSelectedRoleId] = useState<string>(
    initialRoles[0]?.id || ''
  );

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) || null,
    [roles, selectedRoleId]
  );

  const [editDraft, setEditDraft] = useState<{
    roleId: string;
    nameFa: string;
    descriptionFa: string;
    permissionIds: string[];
  }>(() => ({
    roleId: initialRoles[0]?.id || '',
    nameFa: initialRoles[0]?.nameFa || '',
    descriptionFa: initialRoles[0]?.descriptionFa || '',
    permissionIds: initialRoles[0]?.permissionIds || [],
  }));
  const [savingRole, setSavingRole] = useState(false);

  // Create Role Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    slug: '',
    nameFa: '',
    descriptionFa: '',
    permissionIds: [] as string[],
  });
  const [creating, setCreating] = useState(false);

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, AdminPermissionItem[]>();
    for (const p of permissions) {
      const list = groups.get(p.module) || [];
      list.push(p);
      groups.set(p.module, list);
    }
    return Array.from(groups.entries());
  }, [permissions]);

  function selectRole(role: AdminRoleItem) {
    setSelectedRoleId(role.id);
    setEditDraft({
      roleId: role.id,
      nameFa: role.nameFa,
      descriptionFa: role.descriptionFa,
      permissionIds: [...role.permissionIds],
    });
  }

  async function reloadRoles(preferredRoleId?: string) {
    const res = await fetch('/api/admin/roles');
    if (res.ok) {
      const data = (await res.json()) as { roles: AdminRoleItem[] };
      setRoles(data.roles);
      const target =
        data.roles.find((r) => r.id === (preferredRoleId || selectedRoleId)) ||
        data.roles[0];
      if (target) selectRole(target);
    }
  }

  async function handleSaveRole(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    setSavingRole(true);
    try {
      const res = await fetch(`/api/admin/roles/${selectedRole.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nameFa: editDraft.nameFa,
          descriptionFa: editDraft.descriptionFa,
          permissionIds: editDraft.permissionIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ذخیره تغییرات نقش.');
        return;
      }

      await reloadRoles(selectedRole.id);
      toast.success('مجوزها و مشخصات نقش با موفقیت ذخیره شدند.');
      router.refresh();
    } catch {
      toast.error('خطا در ارتباط با سرور.');
    } finally {
      setSavingRole(false);
    }
  }

  async function handleCreateRole(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ایجاد نقش جدید.');
        return;
      }

      await reloadRoles(data.role?.id);
      toast.success('نقش جدید با موفقیت ایجاد شد.');
      setCreateOpen(false);
      setCreateForm({ slug: '', nameFa: '', descriptionFa: '', permissionIds: [] });
      router.refresh();
    } catch {
      toast.error('خطا در ارتباط با سرور.');
    } finally {
      setCreating(false);
    }
  }

  function togglePermissionInEdit(perm: AdminPermissionItem, checked: boolean) {
    if (
      selectedRole?.slug === 'super_admin' &&
      PROTECTED_SUPERADMIN_KEYS.has(perm.key) &&
      !checked
    ) {
      return;
    }
    setEditDraft((prev) => ({
      ...prev,
      permissionIds: checked
        ? Array.from(new Set([...prev.permissionIds, perm.id]))
        : prev.permissionIds.filter((id) => id !== perm.id),
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">نقش‌ها و مجوزهای دسترسی</h1>
          <p className="text-sm text-slate-600">
            مدیریت ماتریس دسترسی کنش‌محور (Action-Level RBAC) با سیاست پیش‌فرض
            مسدود
          </p>
        </div>

        <Button
          onClick={() => {
            setCreateForm({
              slug: '',
              nameFa: '',
              descriptionFa: '',
              permissionIds: [],
            });
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          <span>تعریف نقش جدید</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Roles List */}
        <Card className="lg:col-span-4">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-base">
              فهرست نقش‌ها ({toPersianDigits(roles.length)})
            </CardTitle>
            <CardDescription>
              برای مشاهده یا ویرایش مجوزها، یک نقش را انتخاب کنید
            </CardDescription>
          </CardHeader>
          <CardContent className="p-2 space-y-1">
            {roles.map((r) => {
              const active = r.id === selectedRoleId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectRole(r)}
                  className={`w-full text-right rounded-lg px-3.5 py-3 transition-colors cursor-pointer border ${
                    active
                      ? 'bg-blue-50/70 border-blue-200 text-slate-900'
                      : 'border-transparent hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{r.nameFa}</span>
                    <span className="text-[11px] text-slate-500">
                      {r.isSystem ? 'نقش سیستمی' : 'سفارشی'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1 text-xs text-slate-500">
                    <span dir="ltr" className="font-[family-name:var(--font-mono)]">
                      {r.slug}
                    </span>
                    <span className="tabular-nums">
                      {toPersianDigits(r.permissionIds.length)} مجوز
                    </span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Permission Matrix Editor */}
        <Card className="lg:col-span-8">
          {!selectedRole ? (
            <CardContent className="p-8 text-sm text-slate-500">
              نقشی انتخاب نشده است.
            </CardContent>
          ) : (
            <form onSubmit={handleSaveRole}>
              <CardHeader className="border-b border-slate-100">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-blue-700" />
                    <CardTitle className="text-base">
                      پیکربندی نقش: {selectedRole.nameFa}
                    </CardTitle>
                  </div>
                  <span
                    dir="ltr"
                    className="text-xs font-[family-name:var(--font-mono)] text-slate-500"
                  >
                    {selectedRole.slug}
                  </span>
                </div>
              </CardHeader>

              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="role-name">نام فارسی نقش</Label>
                    <Input
                      id="role-name"
                      required
                      value={editDraft.nameFa}
                      onChange={(e) =>
                        setEditDraft((prev) => ({ ...prev, nameFa: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="role-desc">توضیح نقش</Label>
                    <Input
                      id="role-desc"
                      value={editDraft.descriptionFa}
                      onChange={(e) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          descriptionFa: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                {selectedRole.slug === 'super_admin' && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs text-blue-950 leading-relaxed">
                    برای جلوگیری از قفل شدن سامانه، مجوزهای کلیدی مدیریت ارشد در نقش{' '}
                    <span dir="ltr" className="font-[family-name:var(--font-mono)]">
                      super_admin
                    </span>{' '}
                    قفل شده‌اند و قابل حذف نیستند.
                  </div>
                )}

                <div className="space-y-5">
                  {groupedPermissions.map(([moduleName, modulePerms]) => (
                    <div
                      key={moduleName}
                      className="rounded-lg border border-slate-200 overflow-hidden"
                    >
                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-slate-700">
                          {MODULE_LABELS[moduleName] || moduleName}
                        </h3>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {toPersianDigits(
                            modulePerms.filter((p) =>
                              editDraft.permissionIds.includes(p.id)
                            ).length
                          )}{' '}
                          از {toPersianDigits(modulePerms.length)}
                        </span>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {modulePerms.map((p) => {
                          const checked = editDraft.permissionIds.includes(p.id);
                          const locked =
                            selectedRole.slug === 'super_admin' &&
                            PROTECTED_SUPERADMIN_KEYS.has(p.key);
                          return (
                            <label
                              key={p.id}
                              className={`flex items-start justify-between gap-3 px-4 py-3 text-sm ${
                                locked
                                  ? 'bg-slate-50/50 cursor-not-allowed'
                                  : 'hover:bg-slate-50/70 cursor-pointer'
                              }`}
                            >
                              <div className="flex items-start gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={locked}
                                  onChange={(e) =>
                                    togglePermissionInEdit(p, e.target.checked)
                                  }
                                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-700"
                                />
                                <div>
                                  <div className="font-medium text-slate-900 flex items-center gap-1.5">
                                    <span>{p.nameFa}</span>
                                    {locked && (
                                      <Lock className="h-3 w-3 text-slate-400" />
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {p.descriptionFa}
                                  </p>
                                </div>
                              </div>

                              <span
                                dir="ltr"
                                className="text-[11px] font-[family-name:var(--font-mono)] text-slate-500 shrink-0 pt-0.5"
                              >
                                {p.key}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-end pt-2">
                  <Button type="submit" disabled={savingRole}>
                    {savingRole ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    <span>ذخیره تغییرات نقش</span>
                  </Button>
                </div>
              </CardContent>
            </form>
          )}
        </Card>
      </div>

      {/* Create Custom Role Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعریف نقش جدید</DialogTitle>
            <DialogDescription>
              یک نقش سفارشی با مجموعه مجوزهای دلخواه برای اپراتورها تعریف کنید.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRole} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-role-name">نام فارسی نقش</Label>
                <Input
                  id="new-role-name"
                  required
                  value={createForm.nameFa}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, nameFa: e.target.value }))
                  }
                  placeholder="مثلاً: کارشناس ممیزی اسناد"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-role-slug">شناسه انگلیسی (Slug)</Label>
                <Input
                  id="new-role-slug"
                  dir="ltr"
                  required
                  value={createForm.slug}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                    }))
                  }
                  placeholder="document_auditor"
                  className="font-[family-name:var(--font-mono)] text-left"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-role-desc">توضیحات نقش</Label>
              <Input
                id="new-role-desc"
                value={createForm.descriptionFa}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, descriptionFa: e.target.value }))
                }
                placeholder="شرح وظایف و حدود دسترسی این نقش..."
              />
            </div>

            <div className="space-y-2">
              <Label>انتخاب مجوزها</Label>
              <div className="space-y-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200 p-3">
                {groupedPermissions.map(([moduleName, modulePerms]) => (
                  <div key={moduleName} className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-600">
                      {MODULE_LABELS[moduleName] || moduleName}
                    </div>
                    <div className="space-y-1">
                      {modulePerms.map((p) => {
                        const checked = createForm.permissionIds.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex items-center justify-between gap-2 text-xs p-1.5 rounded hover:bg-slate-50 cursor-pointer"
                          >
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setCreateForm((f) => ({
                                    ...f,
                                    permissionIds: e.target.checked
                                      ? [...f.permissionIds, p.id]
                                      : f.permissionIds.filter((id) => id !== p.id),
                                  }))
                                }
                              />
                              <span className="text-slate-800">{p.nameFa}</span>
                            </span>
                            <span
                              dir="ltr"
                              className="font-[family-name:var(--font-mono)] text-slate-400"
                            >
                              {p.key}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>ایجاد نقش</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
