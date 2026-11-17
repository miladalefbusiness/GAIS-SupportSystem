'use client';

import { useState } from 'react';
import {
  ArrowRight,
  Bot,
  Download,
  Headset,
  History,
  Loader2,
  Lock,
  MessageSquare,
  Paperclip,
  Send,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import Link from 'next/link';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBytesFa, toPersianDigits } from '@/src/lib/jalali';
import {
  TICKET_PRIORITY_LABEL_FA,
  TICKET_STATUS_LABEL_FA,
  type TicketPriority,
  type TicketStatus,
} from '@/src/modules/tickets/schemas';

export interface OperatorTicketDetailPayload {
  ticket: {
    id: string;
    referenceCode: string;
    subject: string;
    status: TicketStatus;
    priority: TicketPriority;
    conversationMode: string;
    aiAutoReplyEnabled: boolean;
    departmentId: string;
    departmentNameFa: string;
    departmentMaxUploadMb: number;
    assignedOperatorId: string | null;
    assignedOperatorName: string | null;
    linkedAiConversationId: string | null;
    lastMessageAt: string;
    createdAt: string;
    resolvedAt: string | null;
    closedAt: string | null;
  };
  customer: {
    customerRef: string;
    fullName: string;
    phoneMasked: string | null;
    recentTicketsInAuthorizedScope: Array<{
      id: string;
      referenceCode: string;
      subject: string;
      status: string;
      departmentNameFa: string;
      createdAt: string;
    }>;
    threadHistory?: Array<{
      id: string;
      sourceType: 'ticket' | 'ai_conversation';
      ticketId: string | null;
      referenceCode: string | null;
      title: string;
      departmentNameFa: string;
      senderRole: string;
      body: string;
      createdAt: string;
    }>;
  };
  messages: Array<{
    id: string;
    senderType: 'customer' | 'operator' | 'ai_assistant' | 'system';
    senderLabel: string;
    visibility: 'public' | 'internal_note';
    body: string;
    createdAt: string;
    attachments: Array<{
      id: string;
      originalFilename: string;
      mimeType: string;
      byteSize: number;
      scanStatus: string;
    }>;
  }>;
  attachments: Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    scanStatus: string;
  }>;
  aiSourceContext: Array<{
    id: string;
    queryText: string;
    topScore: number;
    abstained: boolean;
    sources: Array<{
      sourceType: string;
      sourceId: string;
      title: string;
      score: number;
      snippet: string;
    }>;
    createdAt: string;
  }>;
  activities: Array<{
    id: string;
    activityType: string;
    actorLabel: string;
    createdAt: string;
  }>;
  departmentOperators: Array<{
    userId: string;
    name: string;
    isAvailable: boolean;
  }>;
  transferableDepartments: Array<{
    id: string;
    nameFa: string;
  }>;
}

const ACTIVITY_LABELS_FA: Record<string, string> = {
  ticket_created: 'ایجاد تیکت',
  converted_from_ai: 'تبدیل از گفت‌وگوی هوشمند',
  assigned: 'تخصیص به اپراتور',
  reassigned: 'تغییر اپراتور مسئول',
  unassigned: 'بازگشت به صف دپارتمان',
  transferred: 'انتقال بین دپارتمانی',
  department_transferred: 'انتقال به دپارتمان جدید',
  status_changed: 'تغییر وضعیت تیکت',
  priority_changed: 'تغییر اولویت',
  customer_replied: 'پاسخ جدید مشتری',
  operator_replied: 'ارسال پاسخ رسمی اپراتور',
  internal_note_added: 'ثبت یادداشت داخلی',
  ai_toggled: 'تغییر وضعیت پاسخگویی هوشمند',
};

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

export function TicketDetailWorkspace({
  initialDetail,
  canReply,
  canInternalNotes,
  canAssign,
}: {
  initialDetail: OperatorTicketDetailPayload;
  canReply: boolean;
  canInternalNotes: boolean;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<OperatorTicketDetailPayload>(initialDetail);

  const [visibility, setVisibility] = useState<'public' | 'internal_note'>(
    canReply ? 'public' : 'internal_note'
  );
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sendingMsg, setSendingMsg] = useState(false);

  const [updatingMeta, setUpdatingMeta] = useState(false);
  const [selectedOperatorId, setSelectedOperatorId] = useState(
    initialDetail.ticket.assignedOperatorId ?? ''
  );
  const [assigning, setAssigning] = useState(false);

  const [transferDeptId, setTransferDeptId] = useState(
    initialDetail.transferableDepartments.find(
      (d) => d.id !== initialDetail.ticket.departmentId
    )?.id ?? initialDetail.ticket.departmentId
  );
  const [transferReason, setTransferReason] = useState('');
  const [transferring, setTransferring] = useState(false);

  const t = detail.ticket;

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (sendingMsg || !body.trim()) return;

    setSendingMsg(true);
    try {
      let res: Response;
      if (visibility === 'public' && files.length > 0) {
        const fd = new FormData();
        fd.set('body', body.trim());
        fd.set('visibility', 'public');
        for (const f of files) fd.append('files', f);
        res = await fetch(`/api/workspace/tickets/${t.id}/messages`, {
          method: 'POST',
          body: fd,
        });
      } else {
        res = await fetch(`/api/workspace/tickets/${t.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: body.trim(),
            visibility,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ثبت پیام.');
        return;
      }

      setDetail(data);
      setBody('');
      setFiles([]);
      toast.success(
        visibility === 'internal_note'
          ? 'یادداشت داخلی محرمانه ثبت شد.'
          : 'پاسخ رسمی برای مشتری ارسال شد.'
      );
    } catch {
      toast.error('خطای شبکه در ارسال پیام.');
    } finally {
      setSendingMsg(false);
    }
  }

  async function handleUpdateMeta(patch: {
    status?: TicketStatus;
    priority?: TicketPriority;
    aiAutoReplyEnabled?: boolean;
  }) {
    if (updatingMeta) return;
    setUpdatingMeta(true);
    try {
      const res = await fetch(`/api/workspace/tickets/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در به‌روزرسانی تیکت.');
        return;
      }
      setDetail(data);
      toast.success('تغییرات تیکت ذخیره شد.');
    } catch {
      toast.error('خطای شبکه.');
    } finally {
      setUpdatingMeta(false);
    }
  }

  async function handleAssignOperator() {
    if (assigning) return;
    setAssigning(true);
    try {
      const res = await fetch(`/api/workspace/tickets/${t.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId: selectedOperatorId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در تخصیص اپراتور.');
        return;
      }
      setDetail(data);
      toast.success('مسئول تیکت به‌روزرسانی شد.');
    } catch {
      toast.error('خطای شبکه.');
    } finally {
      setAssigning(false);
    }
  }

  async function handleTransferDepartment() {
    if (transferring || !transferDeptId || transferDeptId === t.departmentId) return;
    setTransferring(true);
    try {
      const res = await fetch(`/api/workspace/tickets/${t.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDepartmentId: transferDeptId,
          reason: transferReason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در انتقال بین دپارتمانی.');
        return;
      }

      if (data.transferredAway) {
        toast.success(
          `تیکت به دپارتمان «${data.targetDepartmentNameFa}» منتقل شد.`
        );
        router.push('/workspace/desk');
        router.refresh();
        return;
      }

      if (data.detail) {
        setDetail(data.detail);
        setSelectedOperatorId(data.detail.ticket.assignedOperatorId ?? '');
      }
      setTransferReason('');
      toast.success('انتقال بین دپارتمانی انجام شد.');
    } catch {
      toast.error('خطای شبکه.');
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              dir="ltr"
              className="font-[family-name:var(--font-mono)] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded"
            >
              {t.referenceCode}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
              {t.departmentNameFa}
            </span>
            <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-emerald-800">
              {TICKET_STATUS_LABEL_FA[t.status] || t.status}
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">{t.subject}</h1>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href={`/workspace/desk/${t.departmentId}`}>
            <ArrowRight className="h-4 w-4" />
            <span>بازگشت به صف دپارتمان</span>
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Conversation & Composer */}
        <div className="lg:col-span-8 space-y-4">
          <Card className="bg-white overflow-hidden">
            <CardHeader className="border-b border-slate-100 py-3.5 px-5 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">روند گفت‌وگو و یادداشت‌های داخلی</CardTitle>
              <span className="text-xs text-slate-500 tabular-nums">
                {toPersianDigits(detail.messages.length)} پیام
              </span>
            </CardHeader>

            <CardContent className="p-5 bg-slate-50/50 space-y-3 max-h-[520px] overflow-y-auto">
              {detail.messages.map((m) => {
                const isInternal = m.visibility === 'internal_note';
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl p-4 text-sm space-y-2 ${
                      isInternal
                        ? 'bg-amber-50 border border-amber-300 text-amber-950'
                        : m.senderType === 'customer'
                        ? 'bg-white border border-slate-200 text-slate-900 ml-6'
                        : m.senderType === 'operator'
                        ? 'bg-blue-700 text-white mr-6'
                        : m.senderType === 'ai_assistant'
                        ? 'bg-slate-100 border border-slate-200 text-slate-900 ml-6'
                        : 'bg-slate-100 text-slate-700 text-xs'
                    }`}
                  >
                    <div
                      className={`flex items-center justify-between gap-2 text-[11px] ${
                        isInternal
                          ? 'text-amber-800'
                          : m.senderType === 'operator'
                          ? 'text-blue-100'
                          : 'text-slate-500'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 font-semibold">
                        {isInternal ? (
                          <Lock className="h-3.5 w-3.5 text-amber-700" />
                        ) : m.senderType === 'customer' ? (
                          <User className="h-3.5 w-3.5 text-slate-600" />
                        ) : m.senderType === 'operator' ? (
                          <Headset className="h-3.5 w-3.5" />
                        ) : m.senderType === 'ai_assistant' ? (
                          <Bot className="h-3.5 w-3.5 text-blue-700" />
                        ) : null}
                        <span>{m.senderLabel}</span>
                        {isInternal && (
                          <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                            یادداشت داخلی محرمانه (پنهان از مشتری)
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums">{formatDateFa(m.createdAt)}</span>
                    </div>

                    <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>

                    {m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {m.attachments.map((att) => (
                          <a
                            key={att.id}
                            href={`/api/workspace/tickets/${t.id}/attachments/${att.id}`}
                            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${
                              m.senderType === 'operator' && !isInternal
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
                );
              })}
            </CardContent>

            {(canReply || canInternalNotes) && (
              <form
                onSubmit={handleSendMessage}
                className="border-t border-slate-200 bg-white p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {canReply && (
                    <button
                      type="button"
                      onClick={() => setVisibility('public')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        visibility === 'public'
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      پاسخ رسمی به مشتری (عمومی)
                    </button>
                  )}
                  {canInternalNotes && (
                    <button
                      type="button"
                      onClick={() => setVisibility('internal_note')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5 ${
                        visibility === 'internal_note'
                          ? 'bg-amber-600 text-white'
                          : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span>یادداشت داخلی محرمانه</span>
                    </button>
                  )}
                </div>

                <textarea
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={
                    visibility === 'internal_note'
                      ? 'یادداشت محرمانه برای همکاران و مدیر دپارتمان (برای مشتری ارسال نمی‌شود)...'
                      : 'پاسخ رسمی خود را برای مشتری بنویسید...'
                  }
                  className={`w-full rounded-lg border p-3 text-sm ${
                    visibility === 'internal_note'
                      ? 'border-amber-300 bg-amber-50/40'
                      : 'border-slate-300 bg-white'
                  }`}
                />

                {visibility === 'public' && files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {files.map((f, idx) => (
                      <span
                        key={`${f.name}-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                      >
                        <span className="truncate max-w-40">{f.name}</span>
                        <span className="text-slate-400 tabular-nums">
                          ({formatBytesFa(f.size)})
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setFiles((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label="حذف فایل"
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  {visibility === 'public' ? (
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer hover:text-slate-900">
                      <Paperclip className="h-3.5 w-3.5" />
                      <span>
                        {files.length > 0
                          ? `${toPersianDigits(files.length)} فایل انتخاب شد`
                          : 'پیوست فایل در پاسخ'}
                      </span>
                      <input
                        type="file"
                        multiple
                        accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md"
                        onChange={(e) =>
                          setFiles(Array.from(e.target.files ?? []))
                        }
                        className="hidden"
                      />
                    </label>
                  ) : (
                    <span className="text-[11px] text-amber-800">
                      یادداشت داخلی هرگز در پورتال مشتری نمایش داده نمی‌شود.
                    </span>
                  )}

                  <Button type="submit" disabled={sendingMsg || !body.trim()}>
                    {sendingMsg ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    <span>
                      {visibility === 'internal_note'
                        ? 'ثبت یادداشت داخلی'
                        : 'ارسال پاسخ رسمی'}
                    </span>
                  </Button>
                </div>
              </form>
            )}
          </Card>

          {/* Unified Customer Thread History Across Tickets & AI Chats */}
          {detail.customer.threadHistory && detail.customer.threadHistory.length > 0 && (
            <Card className="bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-700" />
                    <CardTitle className="text-sm">
                      رشته پیام‌ها و سوابق اخیر این کاربر (پرونده کد ملی)
                    </CardTitle>
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {toPersianDigits(detail.customer.threadHistory.length)} پیام قبلی
                  </span>
                </div>
                <CardDescription className="text-xs">
                  آخرین پیام‌های ثبت‌شده توسط این کاربر در تیکت‌های پیشین و گفت‌وگوهای دستیار هوشمند در دپارتمان‌های مجاز
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 max-h-80 overflow-y-auto text-xs">
                {detail.customer.threadHistory.map((item) => {
                  const roleLabel =
                    item.senderRole === 'customer'
                      ? 'کاربر'
                      : item.senderRole === 'operator'
                      ? 'اپراتور'
                      : item.senderRole === 'ai_assistant' || item.senderRole === 'assistant'
                      ? 'دستیار هوشمند'
                      : 'سامانه';
                  const roleBadgeClass =
                    item.senderRole === 'customer'
                      ? 'bg-blue-50 text-blue-800 border-blue-200'
                      : item.senderRole === 'operator'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200';
                  return (
                    <div
                      key={`${item.sourceType}-${item.id}`}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded border px-1.5 py-0.5 font-semibold ${roleBadgeClass}`}>
                            {roleLabel}
                          </span>
                          <span className="font-medium text-slate-800">
                            {item.departmentNameFa}
                          </span>
                          <span className="text-slate-400">·</span>
                          {item.ticketId && item.referenceCode ? (
                            <Link
                              href={`/workspace/desk/tickets/${item.ticketId}`}
                              className="text-blue-700 hover:underline font-medium"
                            >
                              <span dir="ltr" className="font-[family-name:var(--font-mono)] ml-1">
                                {item.referenceCode}
                              </span>
                              <span>({item.title})</span>
                            </Link>
                          ) : (
                            <span className="text-slate-600">{item.title}</span>
                          )}
                        </div>
                        <span className="text-slate-400 tabular-nums shrink-0">
                          {formatDateFa(item.createdAt)}
                        </span>
                      </div>
                      <p className="text-slate-800 whitespace-pre-wrap leading-relaxed line-clamp-4">
                        {item.body}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* AI Retrieval Source Context (Operator Traceability) */}
          {detail.aiSourceContext.length > 0 && (
            <Card className="bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-blue-700" />
                  <CardTitle className="text-sm">
                    پیشینه بازیابی مخزن دانش توسط دستیار هوشمند
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  اسناد و امتیازهای بازیابی پیش از ارجاع این گفت‌وگو به اپراتور
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs">
                {detail.aiSourceContext.map((rec) => (
                  <div
                    key={rec.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="font-medium text-slate-900">
                        پرسش: {rec.queryText}
                      </span>
                      <span>
                        {rec.abstained
                          ? 'خودداری از پاسخ قطعی'
                          : `امتیاز برتر: ${rec.topScore}`}
                      </span>
                    </div>
                    {rec.sources.length > 0 && (
                      <div className="text-[11px] text-slate-600">
                        منابع مرتبط:{' '}
                        {rec.sources.map((s) => `${s.title} (${s.score})`).join('، ')}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Controls & Customer Info Sidebar */}
        <div className="lg:col-span-4 space-y-4">
          {/* Customer Info (Strictly No National ID) */}
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">مشخصات مشتری</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">نام کامل:</span>
                <span className="font-semibold text-slate-900">
                  {detail.customer.fullName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">شناسه سیستمی:</span>
                <span
                  dir="ltr"
                  className="font-[family-name:var(--font-mono)] text-slate-700"
                >
                  {detail.customer.customerRef}
                </span>
              </div>
              {detail.customer.phoneMasked && (
                <div className="flex justify-between">
                  <span className="text-slate-500">شماره تماس:</span>
                  <span
                    dir="ltr"
                    className="font-[family-name:var(--font-mono)] text-slate-700"
                  >
                    {detail.customer.phoneMasked}
                  </span>
                </div>
              )}

              {detail.customer.recentTicketsInAuthorizedScope.length > 1 && (
                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                  <p className="font-medium text-slate-600">
                    سایر تیکت‌های این مشتری در دپارتمان‌های مجاز:
                  </p>
                  {detail.customer.recentTicketsInAuthorizedScope
                    .filter((rt) => rt.id !== t.id)
                    .slice(0, 4)
                    .map((rt) => (
                      <Link
                        key={rt.id}
                        href={`/workspace/desk/tickets/${rt.id}`}
                        className="block rounded bg-slate-50 px-2.5 py-1.5 hover:bg-slate-100 text-[11px]"
                      >
                        <span
                          dir="ltr"
                          className="font-[family-name:var(--font-mono)] text-blue-700 ml-1.5"
                        >
                          {rt.referenceCode}
                        </span>
                        <span className="text-slate-800">{rt.subject}</span>
                      </Link>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status, Priority, AI Auto-Reply Controls */}
          {canReply && (
            <Card className="bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">مدیریت وضعیت و اولویت</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="space-y-1">
                  <Label htmlFor="tkt-meta-status">وضعیت تیکت</Label>
                  <select
                    id="tkt-meta-status"
                    value={t.status}
                    disabled={updatingMeta}
                    onChange={(e) =>
                      void handleUpdateMeta({ status: e.target.value as TicketStatus })
                    }
                    className="w-full h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                  >
                    {Object.entries(TICKET_STATUS_LABEL_FA).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="tkt-meta-priority">اولویت</Label>
                  <select
                    id="tkt-meta-priority"
                    value={t.priority}
                    disabled={updatingMeta}
                    onChange={(e) =>
                      void handleUpdateMeta({
                        priority: e.target.value as TicketPriority,
                      })
                    }
                    className="w-full h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                  >
                    {Object.entries(TICKET_PRIORITY_LABEL_FA).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center justify-between pt-1 cursor-pointer">
                  <span className="text-slate-700">پاسخگویی خودکار AI در این تیکت</span>
                  <input
                    type="checkbox"
                    checked={t.aiAutoReplyEnabled}
                    disabled={updatingMeta}
                    onChange={(e) =>
                      void handleUpdateMeta({
                        aiAutoReplyEnabled: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-blue-700"
                  />
                </label>
              </CardContent>
            </Card>
          )}

          {/* Assignment & Cross-Department Transfer */}
          {canAssign && (
            <Card className="bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">تخصیص و انتقال بین دپارتمان‌ها</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="space-y-2">
                  <Label htmlFor="tkt-assign-op">اپراتور مسئول در دپارتمان</Label>
                  <div className="flex gap-2">
                    <select
                      id="tkt-assign-op"
                      value={selectedOperatorId}
                      onChange={(e) => setSelectedOperatorId(e.target.value)}
                      className="flex-1 h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                    >
                      <option value="">بدون تخصیص (بازگشت به صف)</option>
                      {detail.departmentOperators.map((op) => (
                        <option key={op.userId} value={op.userId}>
                          {op.name} {!op.isAvailable ? '(غیرفعال)' : ''}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={assigning}
                      onClick={() => void handleAssignOperator()}
                    >
                      {assigning ? '...' : 'اعمال'}
                    </Button>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-2">
                  <Label htmlFor="tkt-transfer-dept">انتقال به دپارتمان دیگر</Label>
                  <select
                    id="tkt-transfer-dept"
                    value={transferDeptId}
                    onChange={(e) => setTransferDeptId(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                  >
                    {detail.transferableDepartments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nameFa} {d.id === t.departmentId ? '(فعلی)' : ''}
                      </option>
                    ))}
                  </select>
                  <Input
                    placeholder="دلیل انتقال (اختیاری)"
                    value={transferReason}
                    onChange={(e) => setTransferReason(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={transferring || transferDeptId === t.departmentId}
                    onClick={() => void handleTransferDepartment()}
                  >
                    {transferring && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>انتقال تیکت به دپارتمان مقصد</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Activity Log */}
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-slate-600" />
                <CardTitle className="text-sm">تاریخچه عملیات تیکت</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-[11px] max-h-52 overflow-y-auto">
              {detail.activities.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5"
                >
                  <span className="text-slate-700">
                    {ACTIVITY_LABELS_FA[a.activityType] || a.activityType} · {a.actorLabel}
                  </span>
                  <span className="text-slate-400 tabular-nums shrink-0">
                    {formatDateFa(a.createdAt)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
