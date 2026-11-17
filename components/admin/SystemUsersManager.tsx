'use client';

import { useMemo, useState } from 'react';
import {
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Search,
  Trash2,
  UserCheck,
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
import type { SystemUserAdminDto } from '@/src/modules/customers/admin';

export function SystemUsersManager({
  initialUsers,
}: {
  initialUsers: SystemUserAdminDto[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState<SystemUserAdminDto[]>(initialUsers);
  const [search, setSearch] = useState('');
  const [passwordFilter, setPasswordFilter] = useState<'all' | 'has_password' | 'no_password'>('all');

  // Edit / Password Reset Dialog
  const [editingUser, setEditingUser] = useState<SystemUserAdminDto | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete Confirmation Dialog
  const [deletingUser, setDeletingUser] = useState<SystemUserAdminDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const stats = useMemo(() => {
    const total = users.length;
    const withPassword = users.filter((u) => u.hasPassword).length;
    const totalTickets = users.reduce((acc, u) => acc + u.ticketCount, 0);
    return { total, withPassword, totalTickets };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (passwordFilter === 'has_password' && !u.hasPassword) return false;
      if (passwordFilter === 'no_password' && u.hasPassword) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.nationalId.toLowerCase().includes(q) ||
        u.customerRef.toLowerCase().includes(q) ||
        (u.phoneMasked?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [users, search, passwordFilter]);

  async function reloadUsers() {
    const res = await fetch('/api/admin/system-users');
    if (res.ok) {
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
    }
  }

  function openEditDialog(user: SystemUserAdminDto) {
    setEditingUser(user);
    setEditFullName(user.fullName);
    setEditPhone('');
    setEditPassword('');
    setShowPassword(false);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || savingEdit) return;

    const trimmedName = editFullName.trim();
    if (trimmedName.length < 2) {
      toast.error('نام و نام خانوادگی باید حداقل ۲ کاراکتر باشد.');
      return;
    }

    if (editPassword.trim() && editPassword.trim().length < 6) {
      toast.error('رمز عبور جدید باید حداقل ۶ کاراکتر باشد.');
      return;
    }

    setSavingEdit(true);
    try {
      const payload: Record<string, unknown> = {
        fullName: trimmedName,
      };
      if (editPhone.trim()) {
        payload.phone = editPhone.trim();
      }
      if (editPassword.trim()) {
        payload.newPassword = editPassword.trim();
      }

      const res = await fetch(`/api/admin/system-users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در به‌روزرسانی اطلاعات کاربر.');
        return;
      }

      await reloadUsers();
      toast.success(
        editPassword.trim()
          ? 'اطلاعات کاربر ذخیره و رمز عبور جدید تنظیم شد (نشست‌های قبلی لغو شدند).'
          : 'اطلاعات کاربر با موفقیت به‌روزرسانی شد.'
      );
      setEditingUser(null);
      router.refresh();
    } catch {
      toast.error('خطای شبکه در ارتباط با سرور.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleClearPhone() {
    if (!editingUser || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/admin/system-users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در حذف شماره تماس.');
        return;
      }
      await reloadUsers();
      toast.success('شماره تماس کاربر حذف شد.');
      setEditingUser(data.user ?? null);
      router.refresh();
    } catch {
      toast.error('خطای شبکه در ارتباط با سرور.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteUser() {
    if (!deletingUser || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/system-users/${deletingUser.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در حذف حساب کاربر.');
        return;
      }

      await reloadUsers();
      toast.success(
        `حساب «${deletingUser.fullName}» و سوابق مرتبط با موفقیت حذف شد.`
      );
      setDeletingUser(null);
      router.refresh();
    } catch {
      toast.error('خطای شبکه در ارتباط با سرور.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">کاربران سامانه</h1>
          <p className="text-sm text-slate-600">
            مدیریت پرونده کاربران ثبت‌شده با کد ملی، ویرایش مشخصات، تنظیم یا بازیابی
            رمز عبور فراموش‌شده و حذف حساب کاربری
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">کل کاربران سامانه</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums text-slate-900">
              {toPersianDigits(stats.total)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">کاربران دارای رمز عبور</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums text-emerald-700">
              {toPersianDigits(stats.withPassword)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">مجموع تیکت‌های ثبت‌شده</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums text-blue-700">
              {toPersianDigits(stats.totalTickets)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Users Table */}
      <Card className="bg-white">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-700" />
              <CardTitle className="text-base">
                فهرست کاربران سامانه ({toPersianDigits(filteredUsers.length)})
              </CardTitle>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={passwordFilter}
                onChange={(e) =>
                  setPasswordFilter(e.target.value as typeof passwordFilter)
                }
                aria-label="فیلتر وضعیت رمز عبور"
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="all">همه کاربران</option>
                <option value="has_password">دارای رمز عبور</option>
                <option value="no_password">بدون رمز عبور</option>
              </select>

              <div className="relative w-full sm:w-72">
                <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="جستجوی نام، کد ملی، شناسه یا موبایل..."
                  className="pr-9"
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              کاربری مطابق جست‌وجو یا فیلتر فعلی یافت نشد.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">نام و نام خانوادگی</th>
                    <th className="py-3 px-4 font-semibold">کد ملی</th>
                    <th className="py-3 px-4 font-semibold">شناسه سیستمی</th>
                    <th className="py-3 px-4 font-semibold">شماره تماس</th>
                    <th className="py-3 px-4 font-semibold">وضعیت رمز عبور</th>
                    <th className="py-3 px-4 font-semibold">تیکت / گفت‌وگو</th>
                    <th className="py-3 px-4 font-semibold">آخرین فعالیت</th>
                    <th className="py-3 px-4 font-semibold text-left">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((u) => (
                    <tr
                      key={u.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {u.fullName}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          dir="ltr"
                          className="inline-block font-[family-name:var(--font-mono)] text-slate-800 bg-slate-100 px-2 py-0.5 rounded tabular-nums"
                        >
                          {u.nationalId}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          dir="ltr"
                          className="font-[family-name:var(--font-mono)] text-slate-600"
                        >
                          {u.customerRef}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {u.phoneMasked ? (
                          <span
                            dir="ltr"
                            className="font-[family-name:var(--font-mono)] text-slate-600"
                          >
                            {u.phoneMasked}
                          </span>
                        ) : (
                          <span className="text-slate-400">ثبت‌نشده</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {u.hasPassword ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-emerald-800 font-medium">
                            <UserCheck className="h-3 w-3" />
                            <span>تنظیم‌شده</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-amber-800 font-medium">
                            <span>تنظیم‌نشده</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-slate-700">
                        {toPersianDigits(u.ticketCount)} تیکت ·{' '}
                        {toPersianDigits(u.conversationCount)} گفت‌وگو
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-slate-500">
                        {u.lastActivityAt
                          ? formatJalaliDateTime(u.lastActivityAt)
                          : formatJalaliDateTime(u.createdAt)}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog(u)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>ویرایش / تنظیم رمز</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeletingUser(u)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit & Set Password Dialog */}
      <Dialog
        open={Boolean(editingUser)}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
      >
        <DialogContent>
          {editingUser && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>ویرایش حساب کاربر — {editingUser.fullName}</DialogTitle>
                <DialogDescription>
                  کد ملی:{' '}
                  <span dir="ltr" className="font-[family-name:var(--font-mono)] font-semibold">
                    {editingUser.nationalId}
                  </span>{' '}
                  · شناسه: {editingUser.customerRef}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSaveEdit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="sys-user-fullname">نام و نام خانوادگی</Label>
                  <Input
                    id="sys-user-fullname"
                    required
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    placeholder="نام کامل کاربر"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="sys-user-phone">
                      شماره موبایل جدید (اختیاری — فعلی:{' '}
                      {editingUser.phoneMasked ?? 'ندارد'})
                    </Label>
                    {editingUser.phoneMasked && (
                      <button
                        type="button"
                        onClick={() => void handleClearPhone()}
                        disabled={savingEdit}
                        className="text-[11px] text-red-600 hover:underline cursor-pointer"
                      >
                        پاک کردن شماره
                      </button>
                    )}
                  </div>
                  <Input
                    id="sys-user-phone"
                    dir="ltr"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="09123456789 (در صورت عدم تغییر خالی بگذارید)"
                    className="font-[family-name:var(--font-mono)] text-left"
                  />
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-800">
                    <KeyRound className="h-4 w-4 text-blue-700" />
                    <span>تنظیم یا بازیابی رمز عبور جدید (اختیاری)</span>
                  </div>
                  <div className="relative">
                    <Input
                      id="sys-user-password"
                      dir="ltr"
                      type={showPassword ? 'text' : 'password'}
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      placeholder="حداقل ۶ کاراکتر (در صورت عدم تغییر خالی بگذارید)"
                      className="text-left pl-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'پنهان کردن رمز' : 'نمایش رمز'}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    با ثبت رمز عبور جدید، تمام نشست‌های فعال قبلی این کاربر در پورتال مشتریان لغو می‌شوند.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingUser(null)}
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

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deletingUser)}
        onOpenChange={(open) => {
          if (!open) setDeletingUser(null);
        }}
      >
        <DialogContent className="max-w-md">
          {deletingUser && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>تایید حذف حساب کاربر سامانه</DialogTitle>
                <DialogDescription>
                  آیا از حذف کامل حساب «{deletingUser.fullName}» (کد ملی{' '}
                  <span dir="ltr" className="font-[family-name:var(--font-mono)]">
                    {deletingUser.nationalId}
                  </span>
                  ) اطمینان دارید؟ با حذف این حساب، تمام{' '}
                  {toPersianDigits(deletingUser.ticketCount)} تیکت و{' '}
                  {toPersianDigits(deletingUser.conversationCount)} گفت‌وگوی مرتبط و
                  پیوست‌ها به صورت دائمی حذف می‌شوند.
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeletingUser(null)}
                >
                  انصراف
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleting}
                  onClick={() => void handleDeleteUser()}
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>حذف دائمی حساب</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
