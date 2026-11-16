'use client';

import { useEffect, useState } from 'react';
import {
  Bot,
  Download,
  Headset,
  Loader2,
  LogOut,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  Ticket,
  User,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PublicDepartmentCard } from '@/src/modules/departments/service';
import type {
  CustomerTicketDetailDto,
  CustomerTicketSummaryDto,
} from '@/src/modules/tickets/service';
import {
  TICKET_PRIORITY_LABEL_FA,
  TICKET_STATUS_LABEL_FA,
} from '@/src/modules/tickets/schemas';
import type { VerifiedCustomerDto } from './CustomerAuthDialog';

function formatDateFa(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function CustomerTicketsPortal({
  departments,
  customer,
  tickets,
  selectedTicketId,
  onSelectTicket,
  onRefreshSession,
  onOpenAuth,
  onLogout,
}: {
  departments: PublicDepartmentCard[];
  customer: VerifiedCustomerDto | null;
  tickets: CustomerTicketSummaryDto[];
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string | null) => void;
  onRefreshSession: () => Promise<void>;
  onOpenAuth: () => void;
  onLogout: () => Promise<void>;
}) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [description, setDescription] = useState('');
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);

  const [detail, setDetail] = useState<CustomerTicketDetailDto | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    if (!customer || !selectedTicketId) {
      return;
    }
    let active = true;
    fetch(`/api/public/tickets/${selectedTicketId}`)
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) {
          setDetail(null);
          return;
        }
        const data = await res.json();
        if (active) {
          setDetail(data.ticket ?? null);
        }
      })
      .catch(() => {
        if (active) toast.error('خطا در بارگذاری جزئیات تیکت.');
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });
    return () => {
      active = false;
    };
  }, [customer, selectedTicketId]);

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    const chosenDept = departmentId || departments[0]?.id;
    if (!chosenDept) {
      toast.error('دپارتمان فعالی برای ثبت تیکت وجود ندارد.');
      return;
    }

    setCreating(true);
    try {
      const fd = new FormData();
      fd.set('departmentId', chosenDept);
      fd.set('subject', subject);
      fd.set('priority', priority);
      fd.set('description', description);
      for (const file of newFiles) {
        fd.append('files', file);
      }

      const res = await fetch('/api/public/tickets', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ثبت تیکت.');
        return;
      }

      toast.success(`تیکت شما با کد پیگیری ${data.ticket.referenceCode} ثبت شد.`);
      setSubject('');
      setDescription('');
      setNewFiles([]);
      setShowNewForm(false);
      await onRefreshSession();
      onSelectTicket(data.ticket.id);
      setDetail(data.ticket);
    } catch {
      toast.error('خطای ارتباط با سرور.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || replying || !replyBody.trim()) return;

    setReplying(true);
    try {
      const fd = new FormData();
      fd.set('body', replyBody.trim());
      for (const file of replyFiles) {
        fd.append('files', file);
      }

      const res = await fetch(`/api/public/tickets/${detail.id}/messages`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ارسال پیام.');
        return;
      }

      setDetail(data.ticket);
      setReplyBody('');
      setReplyFiles([]);
      await onRefreshSession();
      toast.success('پاسخ شما ثبت شد.');
    } catch {
      toast.error('خطای شبکه در ارسال پاسخ.');
    } finally {
      setReplying(false);
    }
  }

  return (
    <section id="customer-portal" className="mx-auto max-w-6xl px-6 pb-14">
      <Card className="bg-white border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Ticket className="h-5 w-5 text-blue-700 shrink-0" />
                <CardTitle className="text-lg">
                  پورتال ثبت و پیگیری تیکت مشتریان
                </CardTitle>
              </div>
              <CardDescription>
                {customer
                  ? `خوش آمدید ${customer.fullName} · می‌توانید تیکت جدید ثبت کنید یا گفت‌وگوهای قبلی خود را ادامه دهید.`
                  : 'با تأیید کد ملی و کد یک‌بارمصرف، سوابق تیکت‌های خود را مشاهده یا درخواست جدید ثبت کنید.'}
              </CardDescription>
            </div>

            {customer ? (
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShowNewForm((prev) => !prev)}
                >
                  <Plus className="h-4 w-4" />
                  <span>{showNewForm ? 'بستن فرم تیکت' : 'ثبت تیکت جدید'}</span>
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={onLogout}>
                  <LogOut className="h-4 w-4" />
                  <span>خروج</span>
                </Button>
              </div>
            ) : (
              <Button type="button" onClick={onOpenAuth}>
                <ShieldCheck className="h-4 w-4" />
                <span>احراز هویت و مشاهده تیکت‌ها</span>
              </Button>
            )}
          </div>
        </CardHeader>

        {customer && (
          <CardContent className="p-6 space-y-6">
            {showNewForm && (
              <form
                onSubmit={handleCreateTicket}
                className="rounded-xl border border-blue-200 bg-blue-50/30 p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    ایجاد تیکت پشتیبانی جدید
                  </h3>
                  <span className="text-xs text-slate-500">
                    توزیع خودکار به اپراتور مجاز دپارتمان
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="tkt-dept">دپارتمان</Label>
                    <select
                      id="tkt-dept"
                      value={departmentId || departments[0]?.id || ''}
                      onChange={(e) => setDepartmentId(e.target.value)}
                      className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    >
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nameFa}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="tkt-priority">اولویت</Label>
                    <select
                      id="tkt-priority"
                      value={priority}
                      onChange={(e) =>
                        setPriority(
                          e.target.value as 'low' | 'normal' | 'high' | 'urgent'
                        )
                      }
                      className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    >
                      <option value="low">کم</option>
                      <option value="normal">عادی</option>
                      <option value="high">بالا</option>
                      <option value="urgent">فوری</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="tkt-subject">عنوان درخواست</Label>
                    <Input
                      id="tkt-subject"
                      placeholder="خلاصه موضوع تیکت"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tkt-desc">شرح کامل درخواست</Label>
                  <textarea
                    id="tkt-desc"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="جزئیات درخواست یا مشکل خود را بنویسید..."
                    required
                    className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <Paperclip className="h-4 w-4 text-slate-500" />
                    <span>افزودن فایل پیوست (PNG، JPEG، WebP، PDF، DOCX، TXT، MD)</span>
                    <input
                      type="file"
                      multiple
                      accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md"
                      onChange={(e) =>
                        setNewFiles(Array.from(e.target.files ?? []))
                      }
                      className="hidden"
                    />
                  </label>

                  <Button type="submit" disabled={creating}>
                    {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>ثبت نهایی تیکت</span>
                  </Button>
                </div>

                {newFiles.length > 0 && (
                  <p className="text-xs text-slate-600">
                    فایل‌های انتخاب‌شده:{' '}
                    {newFiles.map((f) => f.name).join('، ')}
                  </p>
                )}
              </form>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Ticket History List */}
              <div className="lg:col-span-5 space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-500 px-1">
                  سوابق تیکت‌های شما ({tickets.length})
                </h3>
                {tickets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                    هنوز تیکتی برای شما ثبت نشده است. برای شروع دکمه «ثبت تیکت جدید» را بزنید.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[460px] overflow-y-auto pl-1">
                    {tickets.map((t) => {
                      const active = t.id === selectedTicketId;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onSelectTicket(t.id)}
                          className={`w-full text-right rounded-xl border p-4 transition-colors cursor-pointer space-y-2 ${
                            active
                              ? 'border-blue-600 bg-blue-50/50'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              dir="ltr"
                              className="text-xs font-[family-name:var(--font-mono)] font-semibold text-blue-700"
                            >
                              {t.referenceCode}
                            </span>
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              {TICKET_STATUS_LABEL_FA[t.status] || t.status}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-slate-900 line-clamp-1">
                            {t.subject}
                          </p>
                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span>{t.departmentNameFa}</span>
                            <span>
                              اولویت: {TICKET_PRIORITY_LABEL_FA[t.priority] || t.priority}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Ticket Detail & Timeline */}
              <div className="lg:col-span-7">
                {!selectedTicketId ? (
                  <div className="h-full min-h-[300px] rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-center p-6 text-sm text-slate-500">
                    یک تیکت را از فهرست سمت راست انتخاب کنید تا جزئیات و تاریخچه پیام‌ها نمایش داده شود.
                  </div>
                ) : loadingDetail ? (
                  <div className="h-full min-h-[300px] rounded-xl border border-slate-200 flex items-center justify-center p-6 text-sm text-slate-500 gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-700" />
                    <span>در حال بارگذاری تیکت...</span>
                  </div>
                ) : detail ? (
                  <div className="rounded-xl border border-slate-200 overflow-hidden flex flex-col">
                    <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          dir="ltr"
                          className="text-xs font-[family-name:var(--font-mono)] font-bold text-blue-700"
                        >
                          {detail.referenceCode}
                        </span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="rounded bg-white border border-slate-200 px-2 py-0.5 text-slate-700">
                            {detail.departmentNameFa}
                          </span>
                          <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-900">
                            {TICKET_STATUS_LABEL_FA[detail.status] || detail.status}
                          </span>
                        </div>
                      </div>
                      <h4 className="text-base font-bold text-slate-900">
                        {detail.subject}
                      </h4>
                    </div>

                    <div className="p-5 bg-slate-50/40 space-y-3 max-h-[340px] overflow-y-auto">
                      {detail.messages.map((m) => (
                        <div
                          key={m.id}
                          className={`rounded-xl p-3.5 text-sm space-y-1.5 ${
                            m.senderType === 'customer'
                              ? 'bg-blue-700 text-white mr-6'
                              : m.senderType === 'operator'
                              ? 'bg-white border border-emerald-200 text-slate-900 ml-6'
                              : m.senderType === 'ai_assistant'
                              ? 'bg-white border border-slate-200 text-slate-800 ml-6'
                              : 'bg-slate-100 text-slate-700 text-xs'
                          }`}
                        >
                          <div
                            className={`flex items-center justify-between text-[11px] ${
                              m.senderType === 'customer'
                                ? 'text-blue-100'
                                : 'text-slate-500'
                            }`}
                          >
                            <span className="flex items-center gap-1.5 font-medium">
                              {m.senderType === 'customer' ? (
                                <User className="h-3 w-3" />
                              ) : m.senderType === 'operator' ? (
                                <Headset className="h-3 w-3 text-emerald-700" />
                              ) : m.senderType === 'ai_assistant' ? (
                                <Bot className="h-3 w-3 text-blue-700" />
                              ) : null}
                              {m.senderLabel}
                            </span>
                            <span className="tabular-nums">
                              {formatDateFa(m.createdAt)}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {m.body}
                          </p>
                          {m.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {m.attachments.map((att) => (
                                <a
                                  key={att.id}
                                  href={`/api/public/tickets/${detail.id}/attachments/${att.id}`}
                                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${
                                    m.senderType === 'customer'
                                      ? 'bg-blue-800 text-white hover:bg-blue-900'
                                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                                  }`}
                                >
                                  <Download className="h-3 w-3" />
                                  <span>{att.originalFilename}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {detail.status !== 'closed' ? (
                      <form
                        onSubmit={handleSendReply}
                        className="border-t border-slate-200 bg-white p-4 space-y-2.5"
                      >
                        <textarea
                          rows={2}
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          placeholder="پاسخ یا توضیحات تکمیلی خود را بنویسید..."
                          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <Paperclip className="h-3.5 w-3.5" />
                            <span>
                              {replyFiles.length > 0
                                ? `${replyFiles.length} فایل انتخاب شد`
                                : 'پیوست فایل'}
                            </span>
                            <input
                              type="file"
                              multiple
                              accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md"
                              onChange={(e) =>
                                setReplyFiles(Array.from(e.target.files ?? []))
                              }
                              className="hidden"
                            />
                          </label>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={replying || !replyBody.trim()}
                          >
                            {replying ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                            <span>ارسال پاسخ</span>
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                        این تیکت بسته شده است. در صورت نیاز می‌توانید تیکت جدیدی ثبت کنید.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </section>
  );
}
