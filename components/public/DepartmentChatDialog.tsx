'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Headset,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { DepartmentIcon } from '@/components/departments/DepartmentIcon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PublicDepartmentCard } from '@/src/modules/departments/service';

interface ChatMessageItem {
  id: string;
  senderRole: 'customer' | 'ai_assistant' | 'system';
  content: string;
  abstained?: boolean;
  escalationOffered?: boolean;
  createdAt: string;
}

function formatTimeFa(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function DepartmentChatDialog({
  department,
  onClose,
  onRequestCustomerAuthForHandoff,
  onOpenConvertedTicket,
}: {
  department: PublicDepartmentCard | null;
  onClose: () => void;
  onRequestCustomerAuthForHandoff?: (conversationId: string) => void;
  onOpenConvertedTicket?: (ticketId: string) => void;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [convertedTicketRef, setConvertedTicketRef] = useState<{
    id: string;
    referenceCode: string;
  } | null>(null);
  const [needsVerificationConvId, setNeedsVerificationConvId] = useState<string | null>(null);
  const [mode, setMode] = useState<'ai_assisted' | 'waiting_for_operator'>(() =>
    department?.aiEnabled ? 'ai_assisted' : 'waiting_for_operator'
  );
  const [escalatedToHuman, setEscalatedToHuman] = useState(false);
  const [messages, setMessages] = useState<ChatMessageItem[]>(() =>
    department
      ? [
          {
            id: `welcome_${department.id}`,
            senderRole: 'system',
            content:
              department.welcomeMessageFa ||
              `به واحد پشتیبانی «${department.nameFa}» خوش آمدید. پرسش خود را بنویسید یا مستقیماً درخواست ارتباط با اپراتور دهید.`,
            createdAt: new Date().toISOString(),
          },
        ]
      : []
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);

  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  function resetConversation() {
    if (!department) return;
    setConversationId(null);
    setConvertedTicketRef(null);
    setNeedsVerificationConvId(null);
    setMode(department.aiEnabled ? 'ai_assisted' : 'waiting_for_operator');
    setEscalatedToHuman(false);
    setInput('');
    setMessages([
      {
        id: `welcome_${department.id}_${Date.now()}`,
        senderRole: 'system',
        content:
          department.welcomeMessageFa ||
          `به واحد پشتیبانی «${department.nameFa}» خوش آمدید. پرسش خود را بنویسید یا مستقیماً درخواست ارتباط با اپراتور دهید.`,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!department || sending) return;
    const text = input.trim();
    if (text.length < 2) {
      toast.error('لطفاً متن پیام خود را بنویسید.');
      return;
    }

    setSending(true);
    setInput('');

    try {
      const res = await fetch('/api/public/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentId: department.id,
          conversationId: conversationId || undefined,
          message: text,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setInput(text);
        toast.error(data.error || 'خطا در ارسال پیام.');
        return;
      }

      setConversationId(data.conversationId);
      setEscalatedToHuman(Boolean(data.escalatedToHuman));
      setMode(
        data.escalatedToHuman || !data.aiAutoReplyEnabled
          ? 'waiting_for_operator'
          : 'ai_assisted'
      );

      setMessages((prev) => {
        const next: ChatMessageItem[] = [
          ...prev,
          {
            id: data.customerMessage.id,
            senderRole: 'customer',
            content: data.customerMessage.content,
            createdAt: data.customerMessage.createdAt,
          },
        ];
        if (data.assistantMessage) {
          next.push({
            id: data.assistantMessage.id,
            senderRole: 'ai_assistant',
            content: data.assistantMessage.content,
            abstained: data.assistantMessage.abstained,
            escalationOffered: data.assistantMessage.escalationOffered,
            createdAt: data.assistantMessage.createdAt,
          });
        }
        return next;
      });
    } catch {
      setInput(text);
      toast.error('خطای ارتباط با سرور. لطفاً دوباره تلاش کنید.');
    } finally {
      setSending(false);
    }
  }

  async function handleHumanHandoff() {
    if (!department || escalating || escalatedToHuman) return;
    setEscalating(true);

    try {
      let targetConvId = conversationId;
      if (!targetConvId) {
        const initialText =
          input.trim().length >= 2
            ? input.trim()
            : `درخواست ارتباط مستقیم با اپراتور دپارتمان ${department.nameFa}`;
        const chatRes = await fetch('/api/public/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            departmentId: department.id,
            message: initialText,
          }),
        });
        const chatData = await chatRes.json();
        if (!chatRes.ok) {
          toast.error(chatData.error || 'امکان ثبت گفت‌وگو وجود ندارد.');
          return;
        }
        targetConvId = chatData.conversationId;
        setConversationId(targetConvId);
        if (input.trim().length >= 2) {
          setInput('');
        }
      }

      const handoffRes = await fetch(
        `/api/public/ai/conversations/${targetConvId}/handoff`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            departmentId: department.id,
            reason: 'درخواست مستقیم کاربر برای ارتباط با اپراتور',
          }),
        }
      );
      const handoffData = await handoffRes.json();

      if (!handoffRes.ok) {
        toast.error(handoffData.error || 'خطا در ثبت درخواست اپراتور.');
        return;
      }

      setEscalatedToHuman(true);
      setMode('waiting_for_operator');
      if (handoffData.ticket) {
        setConvertedTicketRef({
          id: handoffData.ticket.id,
          referenceCode: handoffData.ticket.referenceCode,
        });
      } else if (handoffData.requiresCustomerVerification && targetConvId) {
        setNeedsVerificationConvId(targetConvId);
      }

      if (Array.isArray(handoffData.messages)) {
        setMessages((prev) => {
          const welcome = prev.find((m) => m.id.startsWith('welcome_'));
          const mapped: ChatMessageItem[] = handoffData.messages.map(
            (m: {
              id: string;
              senderRole: string;
              content: string;
              abstained?: boolean;
              escalationOffered?: boolean;
              createdAt: string;
            }) => ({
              id: m.id,
              senderRole:
                m.senderRole === 'customer'
                  ? 'customer'
                  : m.senderRole === 'ai_assistant'
                  ? 'ai_assistant'
                  : 'system',
              content: m.content,
              abstained: m.abstained,
              escalationOffered: m.escalationOffered,
              createdAt: m.createdAt,
            })
          );
          return welcome ? [welcome, ...mapped] : mapped;
        });
      }

      toast.success(
        handoffData.ticket
          ? `تیکت پشتیبانی با کد ${handoffData.ticket.referenceCode} ثبت و به اپراتور ارجاع شد.`
          : 'درخواست ارتباط با اپراتور با حفظ تاریخچه ثبت شد.'
      );
    } catch {
      toast.error('خطای شبکه در ارتباط با سرور.');
    } finally {
      setEscalating(false);
    }
  }

  return (
    <Dialog
      open={Boolean(department)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        {department && (
          <div className="flex flex-col max-h-[85vh]">
            {/* Header */}
            <DialogHeader className="border-b border-slate-200 bg-white px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 shrink-0">
                    <DepartmentIcon
                      iconKey={department.iconKey}
                      className="h-5 w-5 text-blue-700"
                    />
                  </div>
                  <div>
                    <DialogTitle className="text-base">
                      {department.nameFa}
                    </DialogTitle>
                    <DialogDescription className="text-xs mt-0.5">
                      {escalatedToHuman || mode === 'waiting_for_operator'
                        ? 'وضعیت: ارجاع به اپراتور انسانی (پاسخ خودکار هوش مصنوعی متوقف است)'
                        : department.aiEnabled
                        ? 'وضعیت: پاسخگویی هوشمند مبتنی بر مخزن دانش دپارتمان'
                        : 'وضعیت: بدون دستیار هوشمند · ارتباط با اپراتور'}
                    </DialogDescription>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetConversation}
                    title="شروع گفت‌وگوی جدید"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">گفت‌وگوی جدید</span>
                  </Button>
                  <Button
                    type="button"
                    variant={escalatedToHuman ? 'secondary' : 'default'}
                    size="sm"
                    onClick={handleHumanHandoff}
                    disabled={escalating || escalatedToHuman}
                  >
                    {escalating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Headset className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {escalatedToHuman
                        ? 'ارجاع به اپراتور ثبت شد'
                        : 'ارتباط با اپراتور'}
                    </span>
                  </Button>
                </div>
              </div>
            </DialogHeader>

            {/* Messages Timeline */}
            <div className="flex-1 overflow-y-auto bg-slate-50 px-5 py-4 space-y-3 min-h-[280px] max-h-[420px]">
              {messages.map((msg) => {
                if (msg.senderRole === 'system') {
                  return (
                    <div
                      key={msg.id}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 leading-relaxed"
                    >
                      <div className="flex items-center justify-between gap-2 text-slate-500 mb-1">
                        <span className="font-semibold">پیام سامانه</span>
                        <span className="tabular-nums">
                          {formatTimeFa(msg.createdAt)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  );
                }

                if (msg.senderRole === 'customer') {
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[85%] rounded-xl bg-blue-700 text-white px-4 py-3 text-sm leading-relaxed space-y-1">
                        <div className="flex items-center gap-1.5 text-[11px] text-blue-100">
                          <User className="h-3 w-3" />
                          <span>شما</span>
                          <span>·</span>
                          <span className="tabular-nums">
                            {formatTimeFa(msg.createdAt)}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[88%] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 leading-relaxed space-y-2">
                      <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                        <span className="flex items-center gap-1.5 font-medium text-slate-700">
                          <Bot className="h-3.5 w-3.5 text-blue-700" />
                          دستیار هوشمند سازمانی
                        </span>
                        <span className="tabular-nums">
                          {formatTimeFa(msg.createdAt)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {msg.abstained && (
                        <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                          <span className="flex items-center gap-1.5">
                            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                            پاسخ تنها بر اساس اسناد تأییدشده ارائه می‌شود.
                          </span>
                          {msg.escalationOffered && !escalatedToHuman && (
                            <button
                              type="button"
                              onClick={handleHumanHandoff}
                              className="font-semibold text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              ارتباط با اپراتور
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {sending && (
                <div className="flex justify-end">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600 flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-700" />
                    <span>در حال جست‌وجو در مخزن دانش دپارتمان...</span>
                  </div>
                </div>
              )}

              <div ref={listEndRef} />
            </div>

            {/* Composer */}
            <form
              onSubmit={handleSendMessage}
              className="border-t border-slate-200 bg-white p-4 space-y-2.5"
            >
              {escalatedToHuman && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span>
                    {convertedTicketRef
                      ? `تیکت پشتیبانی با کد ${convertedTicketRef.referenceCode} ثبت شد و در صف کارشناس دپارتمان است.`
                      : 'این گفت‌وگو به اپراتور ارجاع شده و پاسخگویی خودکار متوقف است. برای دریافت کد پیگیری تیکت و ارسال فایل، کد ملی خود را تأیید کنید.'}
                  </span>
                  {convertedTicketRef && onOpenConvertedTicket ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenConvertedTicket(convertedTicketRef.id)}
                    >
                      مشاهده در پورتال تیکت
                    </Button>
                  ) : needsVerificationConvId && onRequestCustomerAuthForHandoff ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        onRequestCustomerAuthForHandoff(needsVerificationConvId)
                      }
                    >
                      تأیید کد ملی و ثبت تیکت رسمی
                    </Button>
                  ) : null}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendMessage(e);
                    }
                  }}
                  rows={2}
                  placeholder="سؤال یا درخواست خود را بنویسید... (Enter برای ارسال)"
                  className="flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
                <Button type="submit" disabled={sending || input.trim().length < 2}>
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  <span>ارسال</span>
                </Button>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
