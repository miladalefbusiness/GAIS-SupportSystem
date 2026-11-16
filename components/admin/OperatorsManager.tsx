'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  KeyRound,
  Loader2,
  Plus,
  Search,
  Shield,
  Users,
} from 'lucide-react';
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
import { formatJalaliDateTime, toPersianDigits } from '@/src/lib/jalali';

export interface AdminOperatorItem {
  id: string;
  username: string;
  email: string;
  name: string;
  status: 'active' | 'inactive' | 'suspended';
  mustChangePassword: boolean;
  isBootstrapAdmin: boolean;
  isAvailable: boolean;
  availabilityNote: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  roles: Array<{ roleId: string; slug: string; nameFa: string }>;
  departments: Array<{
    departmentId: string;
    nameFa: string;
    slug: string;
    isManager: boolean;
    isAvailable: boolean;
    maxActiveTickets: number;
  }>;
  overrides: Array<{
    permissionId: string;
    permissionKey: string;
    permissionNameFa: string;
    effect: 'allow' | 'deny';
    reason: string | null;
  }>;
}

export interface RoleOption {
  id: string;
  slug: string;
  nameFa: string;
  descriptionFa: string;
  isSystem: boolean;
}

export interface PermissionOption {
  id: string;
  key: string;
  module: string;
  nameFa: string;
  descriptionFa: string;
}

export interface DepartmentOption {
  id: string;
  nameFa: string;
  slug: string;
  isActive: boolean;
}

const MODULE_LABELS: Record<string, string> = {
  support_desk: 'میز پشتیبانی',
  shared_files: 'مخزن فایل اشتراکی',
  knowledge_base: 'مخزن دانش',
  ai_settings: 'تنظیمات هوش مصنوعی',
  administration: 'مدیریت سامانه',
};

const STATUS_LABELS: Record<string, { label: string; colorClass: string }> = {
  active: { label: 'فعال', colorClass: 'text-emerald-700' },
  inactive: { label: 'غیرفعال', colorClass: 'text-slate-500' },
  suspended: { label: 'تعلیق‌شده', colorClass: 'text-red-700' },
};

export function OperatorsManager({
  initialOperators,
  roles,
  permissions,
  departments,
  canManageRoles,
  currentUserId,
}: {
  initialOperators: AdminOperatorItem[];
  roles: RoleOption[];
  permissions: PermissionOption[];
  departments: DepartmentOption[];
  canManageRoles: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [operators, setOperators] = useState<AdminOperatorItem[]>(initialOperators);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'suspended'>('all');

  // Create Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    name: '',
    password: '',
    mustChangePassword: true,
    isAvailable: true,
    roleIds: [] as string[],
    deptSelections: {} as Record<
      string,
      { selected: boolean; isManager: boolean; maxActiveTickets: number }
    >,
  });
  const [creating, setCreating] = useState(false);

  // Edit Dialog
  const [editingOp, setEditingOp] = useState<AdminOperatorItem | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    status: 'active' as 'active' | 'inactive' | 'suspended',
    isAvailable: true,
    availabilityNote: '',
    resetPassword: '',
    roleIds: [] as string[],
    deptSelections: {} as Record<
      string,
      {
        selected: boolean;
        isManager: boolean;
        isAvailable: boolean;
        maxActiveTickets: number;
      }
    >,
  });
  const [confirmSuspendModal, setConfirmSuspendModal] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Permission Overrides Dialog
  const [overridesOp, setOverridesOp] = useState<AdminOperatorItem | null>(null);
  const [overrideDrafts, setOverrideDrafts] = useState<
    Record<string, { state: 'inherit' | 'allow' | 'deny'; reason: string }>
  >({});
  const [savingOverrides, setSavingOverrides] = useState(false);

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, PermissionOption[]>();
    for (const p of permissions) {
      const list = groups.get(p.module) || [];
      list.push(p);
      groups.set(p.module, list);
    }
    return Array.from(groups.entries());
  }, [permissions]);

  const filteredOperators = useMemo(() => {
    const q = search.trim().toLowerCase();
    return operators.filter((op) => {
      if (statusFilter !== 'all' && op.status !== statusFilter) return false;
      if (!q) return true;
      return (
        op.name.toLowerCase().includes(q) ||
        op.username.toLowerCase().includes(q) ||
        op.email.toLowerCase().includes(q)
      );
    });
  }, [operators, search, statusFilter]);

  async function reloadOperators() {
    const res = await fetch('/api/admin/operators');
    if (res.ok) {
      const data = await res.json();
      setOperators(data.operators);
    }
  }

  function openCreateDialog() {
    const defaultRole = roles.find((r) => r.slug === 'operator');
    setCreateForm({
      username: '',
      email: '',
      name: '',
      password: '',
      mustChangePassword: true,
      isAvailable: true,
      roleIds: defaultRole ? [defaultRole.id] : [],
      deptSelections: {},
    });
    setCreateOpen(true);
  }

  async function handleCreateOperator(e: React.FormEvent) {
    e.preventDefault();
    if (createForm.roleIds.length === 0) {
      toast.error('لطفاً حداقل یک نقش برای اپراتور انتخاب کنید.');
      return;
    }
    setCreating(true);
    try {
      const selectedDepts = Object.entries(createForm.deptSelections)
        .filter(([, v]) => v.selected)
        .map(([departmentId, v]) => ({
          departmentId,
          isManager: v.isManager,
          maxActiveTickets: v.maxActiveTickets,
        }));

      const res = await fetch('/api/admin/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: createForm.username,
          email: createForm.email,
          name: createForm.name,
          password: createForm.password,
          mustChangePassword: createForm.mustChangePassword,
          isAvailable: createForm.isAvailable,
          roleIds: createForm.roleIds,
          departments: selectedDepts,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ایجاد حساب اپراتور.');
        return;
      }

      await reloadOperators();
      toast.success('اپراتور جدید ایجاد شد.');
      setCreateOpen(false);
      router.refresh();
    } catch {
      toast.error('خطا در ارتباط با سرور.');
    } finally {
      setCreating(false);
    }
  }

  function openEditDialog(op: AdminOperatorItem) {
    const deptMap: typeof editForm.deptSelections = {};
    const existingById = new Map(op.departments.map((d) => [d.departmentId, d]));
    for (const dept of departments) {
      const ex = existingById.get(dept.id);
      deptMap[dept.id] = {
        selected: Boolean(ex),
        isManager: ex?.isManager ?? false,
        isAvailable: ex?.isAvailable ?? true,
        maxActiveTickets: ex?.maxActiveTickets ?? 15,
      };
    }

    setEditForm({
      name: op.name,
      email: op.email,
      status: op.status,
      isAvailable: op.isAvailable,
      availabilityNote: op.availabilityNote || '',
      resetPassword: '',
      roleIds: op.roles.map((r) => r.roleId),
      deptSelections: deptMap,
    });
    setEditingOp(op);
  }

  async function submitEditOperator() {
    if (!editingOp) return;
    if (editForm.roleIds.length === 0) {
      toast.error('حداقل یک نقش باید انتخاب شده باشد.');
      return;
    }

    setSavingEdit(true);
    try {
      const selectedDepts = Object.entries(editForm.deptSelections)
        .filter(([, v]) => v.selected)
        .map(([departmentId, v]) => ({
          departmentId,
          isManager: v.isManager,
          isAvailable: v.isAvailable,
          maxActiveTickets: v.maxActiveTickets,
        }));

      const payload: Record<string, unknown> = {
        name: editForm.name,
        email: editForm.email,
        status: editForm.status,
        isAvailable: editForm.isAvailable,
        availabilityNote: editForm.availabilityNote.trim()
          ? editForm.availabilityNote.trim()
          : null,
        roleIds: editForm.roleIds,
        departments: selectedDepts,
      };

      if (editForm.resetPassword.trim()) {
        payload.resetPassword = editForm.resetPassword.trim();
      }

      const res = await fetch(`/api/admin/operators/${editingOp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در بروزرسانی اپراتور.');
        return;
      }

      await reloadOperators();
      toast.success(
        editForm.resetPassword.trim()
          ? 'اطلاعات بروزرسانی و رمز عبور بازنشانی شد (نشست‌های قبلی لغو شدند).'
          : 'اطلاعات اپراتور بروزرسانی شد.'
      );
      setConfirmSuspendModal(false);
      setEditingOp(null);
      router.refresh();
    } catch {
      toast.error('خطا در ارتباط با سرور.');
    } finally {
      setSavingEdit(false);
    }
  }

  function handleEditSubmitClick(e: React.FormEvent) {
    e.preventDefault();
    if (!editingOp) return;
    // Ask confirmation before disabling or suspending an active operator
    if (editingOp.status === 'active' && editForm.status !== 'active') {
      setConfirmSuspendModal(true);
      return;
    }
    void submitEditOperator();
  }

  function openOverridesDialog(op: AdminOperatorItem) {
    const existingMap = new Map(op.overrides.map((o) => [o.permissionId, o]));
    const draft: typeof overrideDrafts = {};
    for (const p of permissions) {
      const ex = existingMap.get(p.id);
      draft[p.id] = {
        state: ex ? ex.effect : 'inherit',
        reason: ex?.reason || '',
      };
    }
    setOverrideDrafts(draft);
    setOverridesOp(op);
  }

  async function handleSaveOverrides() {
    if (!overridesOp) return;
    setSavingOverrides(true);
    try {
      const overrides = Object.entries(overrideDrafts)
        .filter(([, v]) => v.state !== 'inherit')
        .map(([permissionId, v]) => ({
          permissionId,
          effect: v.state as 'allow' | 'deny',
          reason: v.reason.trim() || undefined,
        }));

      const res = await fetch(`/api/admin/operators/${overridesOp.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ثبت استثناهای مجوز.');
        return;
      }

      await reloadOperators();
      toast.success('استثناهای مجوز کاربر ثبت شدند.');
      setOverridesOp(null);
      router.refresh();
    } catch {
      toast.error('خطا در ارتباط با سرور.');
    } finally {
      setSavingOverrides(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">مدیریت اپراتورها و کاربران</h1>
          <p className="text-sm text-slate-600">
            ساخت حساب اپراتور، تخصیص نقش‌ها و دپارتمان‌ها، تغییر وضعیت، بازنشانی
            رمز عبور و استثناهای دسترسی
          </p>
        </div>

        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
          <span>افزودن اپراتور جدید</span>
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-700" />
              <CardTitle className="text-base">
                فهرست کاربران سازمانی ({toPersianDigits(filteredOperators.length)})
              </CardTitle>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as typeof statusFilter)
                }
                aria-label="فیلتر وضعیت"
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="active">فقط فعال</option>
                <option value="inactive">غیرفعال</option>
                <option value="suspended">تعلیق‌شده</option>
              </select>

              <div className="relative w-full sm:w-64">
                <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="جستجوی نام، نام کاربری یا ایمیل..."
                  className="pr-9"
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filteredOperators.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              کاربری مطابق فیلتر فعلی یافت نشد.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredOperators.map((op) => {
                const statusInfo = STATUS_LABELS[op.status] || {
                  label: op.status,
                  colorClass: 'text-slate-600',
                };
                return (
                  <div
                    key={op.id}
                    className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-base font-semibold text-slate-900">
                          {op.name}
                        </span>
                        <span
                          dir="ltr"
                          className="text-xs font-[family-name:var(--font-mono)] text-slate-500"
                        >
                          @{op.username}
                        </span>
                        {op.id === currentUserId && (
                          <span className="text-xs text-blue-700 font-medium">
                            (نشست فعلی شما)
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span
                          dir="ltr"
                          className="font-[family-name:var(--font-mono)] text-slate-500"
                        >
                          {op.email}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={`font-medium ${statusInfo.colorClass}`}>
                          {statusInfo.label}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {op.isAvailable ? 'آماده پاسخگویی' : 'غیرفعال موقت'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          آخرین ورود:{' '}
                          {op.lastLoginAt
                            ? formatJalaliDateTime(op.lastLoginAt)
                            : 'ثبت نشده'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-0.5">
                        <span>
                          نقش‌ها:{' '}
                          <strong className="font-medium text-slate-700">
                            {op.roles.map((r) => r.nameFa).join('، ') || 'بدون نقش'}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          دپارتمان‌ها:{' '}
                          <strong className="font-medium text-slate-700">
                            {op.departments.length > 0
                              ? op.departments
                                  .map((d) =>
                                    d.isManager ? `${d.nameFa} (مدیر)` : d.nameFa
                                  )
                                  .join('، ')
                              : 'بدون دپارتمان'}
                          </strong>
                        </span>
                        {op.overrides.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 font-medium tabular-nums">
                              {toPersianDigits(op.overrides.length)} استثنای مجوز
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canManageRoles && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openOverridesDialog(op)}
                        >
                          <Shield className="h-3.5 w-3.5" />
                          <span>استثناهای مجوز</span>
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditDialog(op)}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>ویرایش و مدیریت</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Operator Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ایجاد حساب اپراتور جدید</DialogTitle>
            <DialogDescription>
              نقش‌ها و دپارتمان‌های مجاز را مشخص کنید. رمز عبور با scrypt هش و در
              پایگاه داده ذخیره می‌شود.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateOperator} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="op-name">نام و نام خانوادگی</Label>
                <Input
                  id="op-name"
                  required
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="مثلاً: سارا محمدی"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="op-username">نام کاربری (لاتین)</Label>
                <Input
                  id="op-username"
                  dir="ltr"
                  required
                  value={createForm.username}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      username: e.target.value.toLowerCase(),
                    }))
                  }
                  placeholder="s.mohammadi"
                  className="font-[family-name:var(--font-mono)] text-left"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="op-email">نشانی ایمیل</Label>
                <Input
                  id="op-email"
                  dir="ltr"
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="sara@org.local"
                  className="font-[family-name:var(--font-mono)] text-left"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="op-password">رمز عبور اولیه (حداقل ۱۰ کاراکتر + عدد)</Label>
                <Input
                  id="op-password"
                  dir="ltr"
                  type="password"
                  required
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, password: e.target.value }))
                  }
                  placeholder="••••••••••"
                  className="text-left"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>نقش‌های کاربری (حداقل یک نقش)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3">
                {roles.map((r) => {
                  const checked = createForm.roleIds.includes(r.id);
                  return (
                    <label
                      key={r.id}
                      className="flex items-start gap-2 text-xs cursor-pointer p-1.5 rounded hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            roleIds: e.target.checked
                              ? [...f.roleIds, r.id]
                              : f.roleIds.filter((id) => id !== r.id),
                          }))
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300"
                      />
                      <div>
                        <div className="font-medium text-slate-900">{r.nameFa}</div>
                        <div className="text-slate-500">{r.slug}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>تخصیص به دپارتمان‌ها (اختیاری)</Label>
              {departments.length === 0 ? (
                <p className="text-xs text-slate-500">
                  هنوز دپارتمانی ایجاد نشده است.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 max-h-48 overflow-y-auto">
                  {departments.map((d) => {
                    const sel = createForm.deptSelections[d.id] || {
                      selected: false,
                      isManager: false,
                      maxActiveTickets: 15,
                    };
                    return (
                      <div
                        key={d.id}
                        className="p-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sel.selected}
                            onChange={(e) =>
                              setCreateForm((f) => ({
                                ...f,
                                deptSelections: {
                                  ...f.deptSelections,
                                  [d.id]: { ...sel, selected: e.target.checked },
                                },
                              }))
                            }
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="font-medium text-slate-800">{d.nameFa}</span>
                        </label>

                        {sel.selected && (
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={sel.isManager}
                                onChange={(e) =>
                                  setCreateForm((f) => ({
                                    ...f,
                                    deptSelections: {
                                      ...f.deptSelections,
                                      [d.id]: { ...sel, isManager: e.target.checked },
                                    },
                                  }))
                                }
                              />
                              <span>مدیر</span>
                            </label>
                            <Input
                              type="number"
                              min={1}
                              max={200}
                              value={sel.maxActiveTickets}
                              onChange={(e) =>
                                setCreateForm((f) => ({
                                  ...f,
                                  deptSelections: {
                                    ...f.deptSelections,
                                    [d.id]: {
                                      ...sel,
                                      maxActiveTickets: Number(e.target.value) || 15,
                                    },
                                  },
                                }))
                              }
                              className="h-7 w-16 px-2 text-xs"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.mustChangePassword}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      mustChangePassword: e.target.checked,
                    }))
                  }
                />
                <span>الزام به تغییر رمز عبور در اولین ورود</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.isAvailable}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, isAvailable: e.target.checked }))
                  }
                />
                <span>وضعیت اولیه: آماده پاسخگویی</span>
              </label>
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
                <span>ایجاد اپراتور</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Operator Dialog */}
      <Dialog
        open={Boolean(editingOp)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingOp(null);
            setConfirmSuspendModal(false);
          }
        }}
      >
        <DialogContent>
          {editingOp && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>ویرایش اپراتور — {editingOp.name}</DialogTitle>
                <DialogDescription>
                  تغییر نقش‌ها، دپارتمان‌ها، وضعیت حساب و بازنشانی رمز عبور (@
                  {editingOp.username})
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleEditSubmitClick} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-name">نام کامل</Label>
                    <Input
                      id="edit-name"
                      required
                      value={editForm.name}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-email">ایمیل</Label>
                    <Input
                      id="edit-email"
                      dir="ltr"
                      type="email"
                      required
                      value={editForm.email}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, email: e.target.value }))
                      }
                      className="font-[family-name:var(--font-mono)] text-left"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-status">وضعیت حساب کاربری</Label>
                    <select
                      id="edit-status"
                      value={editForm.status}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          status: e.target.value as typeof editForm.status,
                        }))
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      <option value="active">فعال</option>
                      <option value="inactive">غیرفعال</option>
                      <option value="suspended">تعلیق‌شده</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="edit-avail-note">یادداشت وضعیت حضور</Label>
                    <Input
                      id="edit-avail-note"
                      value={editForm.availabilityNote}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          availabilityNote: e.target.value,
                        }))
                      }
                      placeholder="مثلاً: شیفت صبح"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.isAvailable}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, isAvailable: e.target.checked }))
                    }
                  />
                  <span>اپراتور آماده پاسخگویی است</span>
                </label>

                <div className="space-y-2">
                  <Label>نقش‌های تخصیص‌یافته</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3">
                    {roles.map((r) => {
                      const checked = editForm.roleIds.includes(r.id);
                      return (
                        <label
                          key={r.id}
                          className="flex items-center gap-2 text-xs cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                roleIds: e.target.checked
                                  ? [...f.roleIds, r.id]
                                  : f.roleIds.filter((id) => id !== r.id),
                              }))
                            }
                          />
                          <span className="font-medium text-slate-800">{r.nameFa}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>عضویت در دپارتمان‌ها</Label>
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 max-h-48 overflow-y-auto">
                    {departments.map((d) => {
                      const sel = editForm.deptSelections[d.id] || {
                        selected: false,
                        isManager: false,
                        isAvailable: true,
                        maxActiveTickets: 15,
                      };
                      return (
                        <div
                          key={d.id}
                          className="p-2.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sel.selected}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  deptSelections: {
                                    ...f.deptSelections,
                                    [d.id]: { ...sel, selected: e.target.checked },
                                  },
                                }))
                              }
                            />
                            <span className="font-medium text-slate-800">{d.nameFa}</span>
                          </label>

                          {sel.selected && (
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sel.isManager}
                                  onChange={(e) =>
                                    setEditForm((f) => ({
                                      ...f,
                                      deptSelections: {
                                        ...f.deptSelections,
                                        [d.id]: {
                                          ...sel,
                                          isManager: e.target.checked,
                                        },
                                      },
                                    }))
                                  }
                                />
                                <span>مدیر</span>
                              </label>
                              <Input
                                type="number"
                                min={1}
                                max={200}
                                value={sel.maxActiveTickets}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    deptSelections: {
                                      ...f.deptSelections,
                                      [d.id]: {
                                        ...sel,
                                        maxActiveTickets: Number(e.target.value) || 15,
                                      },
                                    },
                                  }))
                                }
                                className="h-7 w-16 px-2 text-xs"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <KeyRound className="h-3.5 w-3.5 text-slate-500" />
                    <span>بازنشانی رمز عبور (اختیاری)</span>
                  </div>
                  <Input
                    dir="ltr"
                    type="password"
                    value={editForm.resetPassword}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, resetPassword: e.target.value }))
                    }
                    placeholder="در صورت نیاز به تغییر رمز، رمز جدید (حداقل ۱۰ کاراکتر + عدد) وارد کنید"
                    className="text-left"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingOp(null)}
                  >
                    انصراف
                  </Button>
                  <Button type="submit" disabled={savingEdit}>
                    {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>ذخیره تغییرات</span>
                  </Button>
                </div>
              </form>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm Deactivate/Suspend Dialog */}
      <Dialog open={confirmSuspendModal} onOpenChange={setConfirmSuspendModal}>
        <DialogContent className="max-w-md">
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>تایید تغییر وضعیت حساب اپراتور</DialogTitle>
              <DialogDescription>
                با غیرفعال یا تعلیق حساب کاربری، تمام نشست‌های فعال این اپراتور
                بلافاصله در سرور لغو خواهد شد و امکان ورود تا زمان فعال‌سازی مجدد
                وجود نخواهد داشت. آیا ادامه می‌دهید؟
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmSuspendModal(false)}
              >
                انصراف
              </Button>
              <Button
                variant="destructive"
                disabled={savingEdit}
                onClick={() => void submitEditOperator()}
              >
                {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>تایید و ذخیره</span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Permission Overrides Dialog */}
      <Dialog
        open={Boolean(overridesOp)}
        onOpenChange={(open) => {
          if (!open) setOverridesOp(null);
        }}
      >
        <DialogContent>
          {overridesOp && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>استثناهای دسترسی فردی — {overridesOp.name}</DialogTitle>
                <DialogDescription>
                  استثناهای اختصاصی روی مجوزهای نقش اعمال می‌شوند. قانون «مسدود»
                  همیشه بر «مجاز» اولویت دارد.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                {groupedPermissions.map(([moduleName, modulePerms]) => (
                  <div key={moduleName} className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-500">
                      {MODULE_LABELS[moduleName] || moduleName}
                    </h4>
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {modulePerms.map((p) => {
                        const draft = overrideDrafts[p.id] || {
                          state: 'inherit',
                          reason: '',
                        };
                        return (
                          <div key={p.id} className="p-3 space-y-2">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <div className="text-xs font-medium text-slate-900">
                                  {p.nameFa}
                                </div>
                                <div
                                  dir="ltr"
                                  className="text-[11px] font-[family-name:var(--font-mono)] text-slate-500 text-right"
                                >
                                  {p.key}
                                </div>
                              </div>

                              <select
                                value={draft.state}
                                onChange={(e) =>
                                  setOverrideDrafts((prev) => ({
                                    ...prev,
                                    [p.id]: {
                                      ...draft,
                                      state: e.target.value as
                                        | 'inherit'
                                        | 'allow'
                                        | 'deny',
                                    },
                                  }))
                                }
                                className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
                              >
                                <option value="inherit">ارث‌بری از نقش</option>
                                <option value="allow">اعطای اختصاصی (Allow)</option>
                                <option value="deny">مسدودسازی اختصاصی (Deny)</option>
                              </select>
                            </div>

                            {draft.state !== 'inherit' && (
                              <Input
                                value={draft.reason}
                                onChange={(e) =>
                                  setOverrideDrafts((prev) => ({
                                    ...prev,
                                    [p.id]: { ...draft, reason: e.target.value },
                                  }))
                                }
                                placeholder="علت ثبت استثنا (اختیاری، ثبت در ممیزی)..."
                                className="h-8 text-xs"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOverridesOp(null)}
                >
                  بستن
                </Button>
                <Button onClick={handleSaveOverrides} disabled={savingOverrides}>
                  {savingOverrides ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  <span>ثبت استثناها</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
