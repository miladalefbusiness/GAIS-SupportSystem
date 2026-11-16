'use client';

import { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Edit3,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Power,
  Search,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DepartmentIcon } from '@/components/departments/DepartmentIcon';
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
import { DEPARTMENT_ICON_OPTIONS } from '@/src/modules/departments/icons';

export interface AdminDepartmentMemberItem {
  id: string;
  departmentId: string;
  userId: string;
  isManager: boolean;
  isAvailable: boolean;
  maxActiveTickets: number;
  userName: string;
  username: string;
  userStatus: string;
}

export interface AdminDepartmentItem {
  id: string;
  slug: string;
  nameFa: string;
  descriptionFa: string;
  iconKey: string;
  displayOrder: number;
  isActive: boolean;
  isPublic: boolean;
  aiEnabled: boolean;
  humanOperatorsAvailable: boolean;
  assignmentStrategy: string;
  welcomeMessageFa: string;
  maxUploadSizeMb: number;
  members: AdminDepartmentMemberItem[];
}

export interface SimpleOperatorOption {
  id: string;
  name: string;
  username: string;
  status: string;
  isAvailable: boolean;
}

interface DepartmentFormState {
  nameFa: string;
  slug: string;
  descriptionFa: string;
  iconKey: string;
  displayOrder: number;
  isActive: boolean;
  isPublic: boolean;
  aiEnabled: boolean;
  humanOperatorsAvailable: boolean;
  assignmentStrategy: 'round_robin' | 'least_loaded' | 'manual_queue';
  welcomeMessageFa: string;
  maxUploadSizeMb: number;
}

const DEFAULT_FORM: DepartmentFormState = {
  nameFa: '',
  slug: '',
  descriptionFa: '',
  iconKey: 'building',
  displayOrder: 0,
  isActive: true,
  isPublic: true,
  aiEnabled: true,
  humanOperatorsAvailable: true,
  assignmentStrategy: 'round_robin',
  welcomeMessageFa: '',
  maxUploadSizeMb: 10,
};

const STRATEGY_LABEL: Record<string, string> = {
  round_robin: 'توزیع نوبتی (Round-Robin)',
  least_loaded: 'کمترین بار کاری',
  manual_queue: 'صف دستی',
};

export function DepartmentsManager({
  initialDepartments,
  operators,
}: {
  initialDepartments: AdminDepartmentItem[];
  operators: SimpleOperatorOption[];
}) {
  const router = useRouter();
  const [departments, setDepartments] = useState<AdminDepartmentItem[]>(initialDepartments);
  const [search, setSearch] = useState('');

  // Create / Edit Dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [form, setForm] = useState<DepartmentFormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Confirm Deactivation Dialog
  const [confirmDeactivateDept, setConfirmDeactivateDept] =
    useState<AdminDepartmentItem | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Members Assignment Dialog
  const [membersDept, setMembersDept] = useState<AdminDepartmentItem | null>(null);
  const [memberDrafts, setMemberDrafts] = useState<
    Record<
      string,
      {
        selected: boolean;
        isManager: boolean;
        isAvailable: boolean;
        maxActiveTickets: number;
      }
    >
  >({});
  const [savingMembers, setSavingMembers] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) =>
        d.nameFa.toLowerCase().includes(q) ||
        d.slug.toLowerCase().includes(q) ||
        d.descriptionFa.toLowerCase().includes(q)
    );
  }, [departments, search]);

  const publicActiveCount = useMemo(
    () => departments.filter((d) => d.isActive && d.isPublic).length,
    [departments]
  );

  function openCreateDialog() {
    setEditingDeptId(null);
    setForm({
      ...DEFAULT_FORM,
      displayOrder: departments.length + 1,
    });
    setFormOpen(true);
  }

  function openEditDialog(dept: AdminDepartmentItem) {
    setEditingDeptId(dept.id);
    setForm({
      nameFa: dept.nameFa,
      slug: dept.slug,
      descriptionFa: dept.descriptionFa,
      iconKey: dept.iconKey,
      displayOrder: dept.displayOrder,
      isActive: dept.isActive,
      isPublic: dept.isPublic,
      aiEnabled: dept.aiEnabled,
      humanOperatorsAvailable: dept.humanOperatorsAvailable,
      assignmentStrategy:
        (dept.assignmentStrategy as DepartmentFormState['assignmentStrategy']) ||
        'round_robin',
      welcomeMessageFa: dept.welcomeMessageFa,
      maxUploadSizeMb: dept.maxUploadSizeMb,
    });
    setFormOpen(true);
  }

  function openMembersDialog(dept: AdminDepartmentItem) {
    const draftMap: typeof memberDrafts = {};
    const existingByUser = new Map(dept.members.map((m) => [m.userId, m]));

    for (const op of operators) {
      const existing = existingByUser.get(op.id);
      draftMap[op.id] = {
        selected: Boolean(existing),
        isManager: existing?.isManager ?? false,
        isAvailable: existing?.isAvailable ?? true,
        maxActiveTickets: existing?.maxActiveTickets ?? 15,
      };
    }
    setMemberDrafts(draftMap);
    setMembersDept(dept);
  }

  async function handleSaveDepartment(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const endpoint = editingDeptId
        ? `/api/admin/departments/${editingDeptId}`
        : '/api/admin/departments';
      const method = editingDeptId ? 'PATCH' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ذخیره اطلاعات دپارتمان.');
        return;
      }

      if (editingDeptId) {
        setDepartments((prev) =>
          prev
            .map((d) =>
              d.id === editingDeptId ? { ...data.department, members: d.members } : d
            )
            .sort((a, b) => a.displayOrder - b.displayOrder)
        );
        toast.success('تغییرات دپارتمان ثبت شد و صفحه عمومی بروزرسانی شد.');
      } else {
        setDepartments((prev) =>
          [...prev, { ...data.department, members: [] }].sort(
            (a, b) => a.displayOrder - b.displayOrder
          )
        );
        toast.success('دپارتمان جدید ایجاد شد.');
      }
      setFormOpen(false);
      router.refresh();
    } catch {
      toast.error('خطا در ارتباط با سرور.');
    } finally {
      setSubmitting(false);
    }
  }

  async function applyToggleFlag(
    dept: AdminDepartmentItem,
    patch: Partial<{ isActive: boolean; isPublic: boolean }>
  ) {
    setTogglingId(dept.id);
    try {
      const res = await fetch(`/api/admin/departments/${dept.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در تغییر وضعیت دپارتمان.');
        return;
      }

      setDepartments((prev) =>
        prev.map((d) => (d.id === dept.id ? { ...data.department, members: d.members } : d))
      );
      toast.success('وضعیت دپارتمان بروزرسانی شد.');
      router.refresh();
    } catch {
      toast.error('خطا در ارتباط با سرور.');
    } finally {
      setTogglingId(null);
      setConfirmDeactivateDept(null);
    }
  }

  async function handleSaveMembers() {
    if (!membersDept) return;
    setSavingMembers(true);
    try {
      const members = Object.entries(memberDrafts)
        .filter(([, v]) => v.selected)
        .map(([userId, v]) => ({
          userId,
          isManager: v.isManager,
          isAvailable: v.isAvailable,
          maxActiveTickets: v.maxActiveTickets,
        }));

      const res = await fetch(`/api/admin/departments/${membersDept.id}/members`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ذخیره اعضای دپارتمان.');
        return;
      }

      // Reload latest admin list from API so member details are exact
      const refreshRes = await fetch('/api/admin/departments');
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json();
        setDepartments(refreshed.departments);
      }
      toast.success('اعضا و مدیران دپارتمان با موفقیت ثبت شدند.');
      setMembersDept(null);
      router.refresh();
    } catch {
      toast.error('خطا در ارتباط با سرور.');
    } finally {
      setSavingMembers(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">مدیریت دپارتمان‌ها</h1>
          <p className="text-sm text-slate-600">
            تعریف پویا دپارتمان‌ها، تنظیم نمایش در پورتال عمومی و تخصیص اپراتورها و
            مدیران دپارتمان
          </p>
        </div>

        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
          <span>ایجاد دپارتمان جدید</span>
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>کل دپارتمان‌ها</CardDescription>
            <CardTitle className="text-xl tabular-nums">
              {toPersianDigits(departments.length)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>منتشرشده در پورتال عمومی (/)</CardDescription>
            <CardTitle className="text-xl text-emerald-700 tabular-nums">
              {toPersianDigits(publicActiveCount)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>اپراتورهای ثبت‌شده سازمان</CardDescription>
            <CardTitle className="text-xl tabular-nums">
              {toPersianDigits(operators.length)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Search & List */}
      <Card>
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-700" />
              <CardTitle className="text-base">فهرست دپارتمان‌های سازمانی</CardTitle>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="جستجو بر اساس نام یا slug..."
                className="pr-9"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {departments.length === 0
                ? 'هنوز هیچ دپارتمانی ایجاد نشده است. برای شروع دکمه «ایجاد دپارتمان جدید» را بزنید.'
                : 'دپارتمانی با این مشخصات یافت نشد.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((dept) => (
                <div
                  key={dept.id}
                  className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 border border-slate-200">
                      <DepartmentIcon
                        iconKey={dept.iconKey}
                        className="h-5 w-5 text-blue-700"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="text-base font-semibold text-slate-900">
                          {dept.nameFa}
                        </h3>
                        <span
                          dir="ltr"
                          className="text-xs font-[family-name:var(--font-mono)] text-slate-500"
                        >
                          /{dept.slug}
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 line-clamp-2 max-w-2xl">
                        {dept.descriptionFa || 'بدون توضیح کوتاه'}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-slate-500">
                        <span
                          className={
                            dept.isActive
                              ? 'text-emerald-700 font-medium'
                              : 'text-red-700 font-medium'
                          }
                        >
                          {dept.isActive ? 'فعال' : 'غیرفعال (بایگانی شده)'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {dept.isPublic
                            ? 'نمایش در پورتال عمومی'
                            : 'مخفی از پورتال عمومی'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {STRATEGY_LABEL[dept.assignmentStrategy] ||
                            dept.assignmentStrategy}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          ترتیب: {toPersianDigits(dept.displayOrder)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {toPersianDigits(dept.members.length)} عضو
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openMembersDialog(dept)}
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span>اعضا ({toPersianDigits(dept.members.length)})</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={togglingId === dept.id}
                      onClick={() =>
                        applyToggleFlag(dept, { isPublic: !dept.isPublic })
                      }
                      title={
                        dept.isPublic
                          ? 'مخفی کردن از پورتال عمومی'
                          : 'انتشار در پورتال عمومی'
                      }
                    >
                      {dept.isPublic ? (
                        <>
                          <EyeOff className="h-3.5 w-3.5" />
                          <span>مخفی‌سازی</span>
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5" />
                          <span>انتشار عمومی</span>
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={togglingId === dept.id}
                      onClick={() => {
                        if (dept.isActive) {
                          setConfirmDeactivateDept(dept);
                        } else {
                          applyToggleFlag(dept, { isActive: true });
                        }
                      }}
                    >
                      <Power className="h-3.5 w-3.5" />
                      <span>{dept.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</span>
                    </Button>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEditDialog(dept)}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>ویرایش</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Department Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingDeptId ? 'ویرایش دپارتمان' : 'ایجاد دپارتمان جدید'}
            </DialogTitle>
            <DialogDescription>
              دپارتمان‌های فعال و عمومی بلافاصله در صفحه اصلی پورتال پشتیبانی نمایش داده
              می‌شوند.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveDepartment} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dept-name">نام فارسی دپارتمان</Label>
                <Input
                  id="dept-name"
                  required
                  value={form.nameFa}
                  onChange={(e) => setForm((f) => ({ ...f, nameFa: e.target.value }))}
                  placeholder="مثلاً: پشتیبانی فنی و سامانه‌ها"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dept-slug">شناسه انگلیسی (Slug)</Label>
                <Input
                  id="dept-slug"
                  dir="ltr"
                  required
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                    }))
                  }
                  placeholder="technical-support"
                  className="font-[family-name:var(--font-mono)] text-left"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dept-desc">توضیح کوتاه برای مراجعین</Label>
              <Input
                id="dept-desc"
                value={form.descriptionFa}
                onChange={(e) =>
                  setForm((f) => ({ ...f, descriptionFa: e.target.value }))
                }
                placeholder="توضیح مختصر درباره خدمات این دپارتمان..."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dept-welcome">پیام خوش‌آمدگویی دپارتمان</Label>
              <textarea
                id="dept-welcome"
                rows={2}
                value={form.welcomeMessageFa}
                onChange={(e) =>
                  setForm((f) => ({ ...f, welcomeMessageFa: e.target.value }))
                }
                placeholder="سلام، به بخش پشتیبانی خوش آمدید..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dept-icon">نماد دپارتمان</Label>
                <select
                  id="dept-icon"
                  value={form.iconKey}
                  onChange={(e) => setForm((f) => ({ ...f, iconKey: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  {DEPARTMENT_ICON_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.labelFa}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dept-strategy">سیاست توزیع تیکت</Label>
                <select
                  id="dept-strategy"
                  value={form.assignmentStrategy}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      assignmentStrategy: e.target
                        .value as DepartmentFormState['assignmentStrategy'],
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <option value="round_robin">توزیع نوبتی (Round-Robin)</option>
                  <option value="least_loaded">کمترین بار کاری</option>
                  <option value="manual_queue">صف دستی</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="dept-order">ترتیب نمایش</Label>
                  <Input
                    id="dept-order"
                    type="number"
                    min={0}
                    value={form.displayOrder}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        displayOrder: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dept-upload">سقف فایل (MB)</Label>
                  <Input
                    id="dept-upload"
                    type="number"
                    min={1}
                    max={200}
                    value={form.maxUploadSizeMb}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        maxUploadSizeMb: Number(e.target.value) || 10,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <span>دپارتمان فعال است</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(e) => setForm((f) => ({ ...f, isPublic: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <span>نمایش در پورتال عمومی</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.aiEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, aiEnabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <span>پاسخگویی اولیه دستیار هوشمند</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.humanOperatorsAvailable}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      humanOperatorsAvailable: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <span>امکان ارجاع به اپراتور انسانی</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{editingDeptId ? 'ذخیره تغییرات' : 'ایجاد دپارتمان'}</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Members & Managers Assignment Dialog */}
      <Dialog
        open={Boolean(membersDept)}
        onOpenChange={(open) => {
          if (!open) setMembersDept(null);
        }}
      >
        <DialogContent>
          {membersDept && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>تخصیص اپراتورها — {membersDept.nameFa}</DialogTitle>
                <DialogDescription>
                  اعضای مجاز این دپارتمان، نقش مدیر دپارتمان و ظرفیت تیکت فعال هر عضو
                  را مشخص کنید.
                </DialogDescription>
              </DialogHeader>

              {operators.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">
                  هنوز کاربری برای تخصیص ثبت نشده است.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-80 overflow-y-auto">
                  {operators.map((op) => {
                    const draft = memberDrafts[op.id] || {
                      selected: false,
                      isManager: false,
                      isAvailable: true,
                      maxActiveTickets: 15,
                    };
                    return (
                      <div
                        key={op.id}
                        className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.selected}
                            onChange={(e) =>
                              setMemberDrafts((prev) => ({
                                ...prev,
                                [op.id]: { ...draft, selected: e.target.checked },
                              }))
                            }
                            className="h-4 w-4 rounded border-slate-300 text-blue-700"
                          />
                          <div>
                            <div className="text-sm font-medium text-slate-900">
                              {op.name}
                            </div>
                            <div
                              dir="ltr"
                              className="text-xs font-[family-name:var(--font-mono)] text-slate-500 text-right"
                            >
                              @{op.username}
                              {op.status !== 'active' ? ` (${op.status})` : ''}
                            </div>
                          </div>
                        </label>

                        {draft.selected && (
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={draft.isManager}
                                onChange={(e) =>
                                  setMemberDrafts((prev) => ({
                                    ...prev,
                                    [op.id]: { ...draft, isManager: e.target.checked },
                                  }))
                                }
                                className="h-3.5 w-3.5 rounded border-slate-300"
                              />
                              <span>مدیر دپارتمان</span>
                            </label>

                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={draft.isAvailable}
                                onChange={(e) =>
                                  setMemberDrafts((prev) => ({
                                    ...prev,
                                    [op.id]: {
                                      ...draft,
                                      isAvailable: e.target.checked,
                                    },
                                  }))
                                }
                                className="h-3.5 w-3.5 rounded border-slate-300"
                              />
                              <span>آماده</span>
                            </label>

                            <div className="flex items-center gap-1.5">
                              <span>سقف تیکت:</span>
                              <Input
                                type="number"
                                min={1}
                                max={200}
                                value={draft.maxActiveTickets}
                                onChange={(e) =>
                                  setMemberDrafts((prev) => ({
                                    ...prev,
                                    [op.id]: {
                                      ...draft,
                                      maxActiveTickets: Number(e.target.value) || 15,
                                    },
                                  }))
                                }
                                className="h-7 w-16 px-2 text-xs"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMembersDept(null)}
                >
                  بستن
                </Button>
                <Button onClick={handleSaveMembers} disabled={savingMembers}>
                  {savingMembers ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  <span>ثبت اعضای دپارتمان</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deactivation Confirmation Dialog */}
      <Dialog
        open={Boolean(confirmDeactivateDept)}
        onOpenChange={(open) => {
          if (!open) setConfirmDeactivateDept(null);
        }}
      >
        <DialogContent className="max-w-md">
          {confirmDeactivateDept && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>تایید غیرفعال‌سازی دپارتمان</DialogTitle>
                <DialogDescription>
                  آیا از غیرفعال کردن دپارتمان «{confirmDeactivateDept.nameFa}» مطمئن
                  هستید؟ این دپارتمان بلافاصله از پورتال عمومی حذف می‌شود، اما سوابق و
                  اعضای آن در پایگاه داده حفظ می‌گردند.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirmDeactivateDept(null)}
                >
                  انصراف
                </Button>
                <Button
                  variant="destructive"
                  disabled={togglingId === confirmDeactivateDept.id}
                  onClick={() =>
                    applyToggleFlag(confirmDeactivateDept, { isActive: false })
                  }
                >
                  {togglingId === confirmDeactivateDept.id && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  <span>تایید غیرفعال‌سازی</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
