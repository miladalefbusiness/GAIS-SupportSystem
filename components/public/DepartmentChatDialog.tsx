'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Headset,
  IdCard,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Ticket,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toPersianDigits } from '@/src/lib/jalali';
import type { ThemeAccentPreset } from '@/src/modules/admin/settings-schema';
import type { PublicDepartmentCard } from '@/src/modules/departments/service';
import type { VerifiedCustomerDto } from './CustomerAuthDialog';

export interface ChatCitationItem {
  refCode: string;
  sourceType: 'qa' | 'document_chunk';
  sourceId: string;
  title: string;
  documentVersion?: number | null;
  pageNumber?: number | null;
  sheetName?: string | null;
  sectionTitle?: string | null;
  score?: number;
}

export interface ChatMessageItem {
  id: string;
  senderRole: 'customer' | 'ai_assistant' | 'system';
  content: string;
  abstained?: boolean;
  escalationOffered?: boolean;
  responseOutcome?: string | null;
  citations?: ChatCitationItem[];
  createdAt: string;
}

export interface GuestIdentityDraft {
  nationalId: string;
  fullName: string;
}

const ACCENT_CHAT_BG: Record<ThemeAccentPreset, string> = {
  blue: 'bg-blue-700 text-white',
  indigo: 'bg-indigo-700 text-white',
  emerald: 'bg-emerald-700 text-white',
  slate: 'bg-slate-800 text-white',
};

const ACCENT_ICON_COLOR: Record<ThemeAccentPreset, string> = {
  blue: 'text-blue-700',
  indigo: 'text-indigo-700',
  emerald: 'text-emerald-700',
  slate: 'text-slate-700',
};

const STORAGE_KEY_PREFIX = 'support_conv_';

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

function buildWelcomeMessage(department: PublicDepartmentCard): ChatMessageItem {
  return {
    id: `welcome_${department.id}`,
    senderRole: 'system',
    content:
      department.welcomeMessageFa ||
      `به واحد پشتیبانی «${department.nameFa}» خوش آمدید. کد ملی و نام و نام خانوادگی خود را وارد کرده و پرسش یا درخواست خود را بنویسید.`,
    createdAt: new Date().toISOString(),
  };
}

function mapServerMessages(
  department: PublicDepartmentCard,
  serverMessages: Array<{
    id: string;
    senderRole: string;
    content: string;
    abstained?: boolean;
    escalationOffered?: boolean;
    responseOutcome?: string | null;
    citations?: ChatCitationItem[];
    createdAt: string;
  }>
): ChatMessageItem[] {
  const welcome = buildWelcomeMessage(department);
  const mapped: ChatMessageItem[] = serverMessages.map((m) => ({
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
    responseOutcome: m.responseOutcome,
    citations: Array.isArray(m.citations) ? m.citations : [],
    createdAt: m.createdAt,
  }));
  return [welcome, ...mapped];
}

export function DepartmentConversationPanel({
  department,
  themeAccent = 'blue',
  variant = 'inline',
  authenticatedCustomer = null,
  guestIdentity,
  onGuestIdentityChange,
  onExpandModal,
  onOpenPortalTracking,
  onOpenConvertedTicket,
}: {
  department: PublicDepartmentCard;
  themeAccent?: ThemeAccentPreset;
  variant?: 'inline' | 'dialog';
  authenticatedCustomer?: VerifiedCustomerDto | null;
  guestIdentity?: GuestIdentityDraft;
  onGuestIdentityChange?: (next: GuestIdentityDraft) => void;
  onExpandModal?: () => void;
  onOpenPortalTracking?: () => void;
  onOpenConvertedTicket?: (ticketId: string) => void;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [convertedTicketRef, setConvertedTicketRef] = useState<{
    id: string;
    referenceCode: string;
  } | null>(null);
  const [mode, setMode] = useState<'ai_assisted' | 'waiting_for_operator'>(() =>
    department.aiEnabled ? 'ai_assisted' : 'waiting_for_operator'
  );
  const [escalatedToHuman, setEscalatedToHuman] = useState(false);
  const [messages, setMessages] = useState<ChatMessageItem[]>(() => [
    buildWelcomeMessage(department),
  ]);
  const [localNationalId, setLocalNationalId] = useState(
    guestIdentity?.nationalId ?? ''
  );
  const [localFullName, setLocalFullName] = useState(
    guestIdentity?.fullName ?? ''
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);

  const nationalId = guestIdentity ? guestIdentity.nationalId : localNationalId;
  const fullName = guestIdentity ? guestIdentity.fullName : localFullName;

  function updateNationalId(val: string) {
    if (onGuestIdentityChange) {
      onGuestIdentityChange({ nationalId: val, fullName });
    } else {
      setLocalNationalId(val);
    }
  }

  function updateFullName(val: string) {
    if (onGuestIdentityChange) {
      onGuestIdentityChange({ nationalId, fullName: val });
    } else {
      setLocalFullName(val);
    }
  }

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const nidInputRef = useRef<HTMLInputElement | null>(null);

  const bubbleBgClass = ACCENT_CHAT_BG[themeAccent] || ACCENT_CHAT_BG.blue;
  const iconColorClass = ACCENT_ICON_COLOR[themeAccent] || ACCENT_ICON_COLOR.blue;

  // Restore ongoing conversation from localStorage when mounting for a department
  useEffect(() => {
    let active = true;
    const storageKey = `${STORAGE_KEY_PREFIX}${department.id}`;
    let savedId: string | null = null;
    try {
      savedId = window.localStorage.getItem(storageKey);
    } catch {
      savedId = null;
    }

    if (!savedId) {
      return;
    }

    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setRestoring(true);
        return fetch(`/api/public/ai/conversations/${encodeURIComponent(savedId)}`);
      })
      .then(async (res) => {
        if (!active || !res) return;
        if (!res.ok) {
          try {
            window.localStorage.removeItem(storageKey);
          } catch {
            // ignore storage errors
          }
          return;
        }
        const data = await res.json();
        if (!active || data.departmentId !== department.id) {
          return;
        }
        setConversationId(data.conversationId);
        setEscalatedToHuman(Boolean(data.escalatedToHuman));
        setMode(
          data.escalatedToHuman || !data.aiAutoReplyEnabled
            ? 'waiting_for_operator'
            : 'ai_assisted'
        );
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(mapServerMessages(department, data.messages));
        }
      })
      .catch(() => {
        // Ignore network errors while restoring optional history
      })
      .finally(() => {
        if (active) setRestoring(false);
      });

    return () => {
      active = false;
    };
  }, [department]);

  useEffect(() => {
    if (messages.length > 1 || sending) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages.length, sending]);

  function persistConversationId(id: string | null) {
    try {
      const key = `${STORAGE_KEY_PREFIX}${department.id}`;
      if (id) {
        window.localStorage.setItem(key, id);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore storage quota errors
    }
  }

  function resetConversation() {
    persistConversationId(null);
    setConversationId(null);
    setConvertedTicketRef(null);
    setMode(department.aiEnabled ? 'ai_assisted' : 'waiting_for_operator');
    setEscalatedToHuman(false);
    setInput('');
    setMessages([buildWelcomeMessage(department)]);
    composerRef.current?.focus();
  }

  function validateIdentityBeforeStart(): boolean {
    if (authenticatedCustomer || conversationId) return true;
    const cleanNid = nationalId.trim();
    const cleanName = fullName.trim();
    if (cleanNid.length < 10 || cleanName.length < 2) {
      toast.error(
        'لطفاً پیش از ارسال پیام، کد ملی (۱۰ رقم) و نام و نام خانوادگی خود را وارد کنید.'
      );
      nidInputRef.current?.focus();
      return false;
    }
    return true;
  }

  async function sendText(rawText: string) {
    if (sending) return;
    if (!validateIdentityBeforeStart()) return;

    const text = rawText.trim();
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
          nationalId: !authenticatedCustomer ? nationalId.trim() || undefined : undefined,
          fullName: !authenticatedCustomer ? fullName.trim() || undefined : undefined,
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
      persistConversationId(data.conversationId);
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
            responseOutcome: data.assistantMessage.responseOutcome,
            citations: Array.isArray(data.assistantMessage.citations)
              ? data.assistantMessage.citations
              : [],
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

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    await sendText(input);
  }

  async function handleHumanHandoff() {
    if (escalating || escalatedToHuman) return;
    if (!validateIdentityBeforeStart()) return;

    setEscalating(true);

    try {
      let targetConvId = conversationId;
      if (!targetConvId) {
        const initialText =
          input.trim().length >= 2
            ? input.trim()
            : `درخواست ارتباط مستقیم با کارشناس دپارتمان ${department.nameFa}`;
        const chatRes = await fetch('/api/public/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            departmentId: department.id,
            nationalId: !authenticatedCustomer ? nationalId.trim() || undefined : undefined,
            fullName: !authenticatedCustomer ? fullName.trim() || undefined : undefined,
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
        persistConversationId(targetConvId);
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
            nationalId: !authenticatedCustomer ? nationalId.trim() || undefined : undefined,
            fullName: !authenticatedCustomer ? fullName.trim() || undefined : undefined,
            reason: 'درخواست کاربر برای ارتباط با کارشناس پشتیبانی',
          }),
        }
      );
      const handoffData = await handoffRes.json();

      if (!handoffRes.ok) {
        toast.error(handoffData.error || 'خطا در ثبت درخواست ارتباط با کارشناس.');
        return;
      }

      setEscalatedToHuman(true);
      setMode('waiting_for_operator');
      if (handoffData.ticket) {
        setConvertedTicketRef({
          id: handoffData.ticket.id,
          referenceCode: handoffData.ticket.referenceCode,
        });
      }

      if (Array.isArray(handoffData.messages)) {
        setMessages(mapServerMessages(department, handoffData.messages));
      }

      toast.success(
        handoffData.ticket
          ? `تیکت شما با کد ${handoffData.ticket.referenceCode} ثبت و برای کارشناس ارسال شد.`
          : 'درخواست ارتباط با کارشناس با حفظ تاریخچه ثبت شد.'
      );
    } catch {
      toast.error('خطای شبکه در ارتباط با سرور.');
    } finally {
      setEscalating(false);
    }
  }

  const starterPrompts = [
    `راهنمایی درباره خدمات ${department.nameFa}`,
    'ساعات و زمان رسیدگی به درخواست‌ها چقدر است؟',
    'مدارک یا اطلاعات مورد نیاز برای پیگیری چیست؟',
  ];

  const hasCustomerTurns = messages.some((m) => m.senderRole === 'customer');
  const showIdentityInputs = !authenticatedCustomer && !conversationId;

  return (
    <div
      className={
        variant === 'inline'
          ? 'rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col min-h-[540px] max-h-[680px]'
          : 'flex flex-col max-h-[85vh]'
      }
    >
      {/* Header */}
      <div
        className={`border-b border-slate-200 bg-white px-5 py-4 ${
          variant === 'dialog' ? 'pl-12' : ''
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 shrink-0">
              <DepartmentIcon
                iconKey={department.iconKey}
                className={`h-5 w-5 ${iconColorClass}`}
              />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900 truncate">
                {department.nameFa}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                {restoring
                  ? 'در حال بازیابی تاریخچه گفت‌وگو...'
                  : escalatedToHuman || mode === 'waiting_for_operator'
                  ? 'ثبت در صف کارشناس پشتیبانی (متصل به پرونده کد ملی شما)'
                  : department.aiEnabled
                  ? 'پاسخگویی آنلاین هوشمند · ثبت و اتصال خودکار به کارشناس'
                  : 'پاسخگویی توسط کارشناسان این دپارتمان'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {variant === 'inline' && onExpandModal && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onExpandModal}
                title="نمایش در پنجره بزرگ‌تر"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">پنجره مجزا</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetConversation}
              title="شروع گفت‌وگوی جدید"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>گفت‌وگوی جدید</span>
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
                  ? 'تیکت برای کارشناس ثبت شد'
                  : 'ثبت تیکت / ارتباط با کارشناس'}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Identity Capture Strip at Conversation Start (No SMS Required) */}
      {showIdentityInputs && (
        <div className="border-b border-slate-200 bg-slate-50/90 px-5 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <IdCard className={`h-3.5 w-3.5 ${iconColorClass}`} />
            <span>مشخصات شروع گفت‌وگو (بدون نیاز به کد پیامکی):</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label htmlFor={`chat-nid-${variant}`} className="text-[11px] text-slate-600">
                کد ملی (۱۰ رقم)
              </Label>
              <Input
                ref={nidInputRef}
                id={`chat-nid-${variant}`}
                dir="ltr"
                inputMode="numeric"
                placeholder="0012345679"
                value={nationalId}
                onChange={(e) => updateNationalId(e.target.value)}
                className="h-9 bg-white text-xs font-[family-name:var(--font-mono)] text-right"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`chat-name-${variant}`} className="text-[11px] text-slate-600">
                نام و نام خانوادگی
              </Label>
              <Input
                id={`chat-name-${variant}`}
                placeholder="مثال: علی رضایی"
                value={fullName}
                onChange={(e) => updateFullName(e.target.value)}
                className="h-9 bg-white text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {authenticatedCustomer && (
        <div className="border-b border-emerald-100 bg-emerald-50/60 px-5 py-2 text-[11px] text-emerald-900 flex items-center justify-between gap-2">
          <span>
            گفت‌وگو به حساب شما متصل است: <strong>{authenticatedCustomer.fullName}</strong>
          </span>
          <span dir="ltr" className="font-[family-name:var(--font-mono)]">
            {authenticatedCustomer.customerRef}
          </span>
        </div>
      )}

      {/* Messages Timeline */}
      <div
        className={`flex-1 overflow-y-auto bg-slate-50 px-5 py-4 space-y-3 ${
          variant === 'dialog' ? 'min-h-[260px] max-h-[390px]' : ''
        }`}
      >
        {messages.map((msg) => {
          if (msg.senderRole === 'system') {
            return (
              <div
                key={msg.id}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 leading-relaxed"
              >
                <div className="flex items-center justify-between gap-2 text-slate-500 mb-1">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Sparkles className={`h-3.5 w-3.5 ${iconColorClass}`} />
                    <span>راهنمای دپارتمان {department.nameFa}</span>
                  </span>
                  <span className="tabular-nums">{formatTimeFa(msg.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            );
          }

          if (msg.senderRole === 'customer') {
            return (
              <div key={msg.id} className="flex justify-start">
                <div
                  className={`max-w-[85%] rounded-xl ${bubbleBgClass} px-4 py-3 text-sm leading-relaxed space-y-1`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-white/80">
                    <User className="h-3 w-3" />
                    <span>{authenticatedCustomer?.fullName || fullName || 'شما'}</span>
                    <span>·</span>
                    <span className="tabular-nums">{formatTimeFa(msg.createdAt)}</span>
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
                    <Bot className={`h-3.5 w-3.5 ${iconColorClass}`} />
                    <span>دستیار پشتیبانی</span>
                  </span>
                  <span className="tabular-nums">{formatTimeFa(msg.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.citations && msg.citations.length > 0 && (
                  <div className="border-t border-slate-100 pt-2 space-y-1.5">
                    <div className="text-[11px] font-medium text-slate-500">
                      منابع مستند پاسخ:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.citations.map((cit) => (
                        <span
                          key={`${msg.id}-${cit.sourceId}`}
                          className="inline-flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                        >
                          <span className="font-semibold text-slate-800">{cit.title}</span>
                          {cit.documentVersion ? (
                            <span className="text-slate-500">
                              · نسخه {toPersianDigits(cit.documentVersion)}
                            </span>
                          ) : null}
                          {cit.sectionTitle ? (
                            <span className="text-slate-500">· {cit.sectionTitle}</span>
                          ) : null}
                          {cit.pageNumber ? (
                            <span className="text-slate-500">
                              · صفحه {toPersianDigits(cit.pageNumber)}
                            </span>
                          ) : null}
                          {cit.sheetName ? (
                            <span className="text-slate-500">· کاربرگ {cit.sheetName}</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(msg.abstained || msg.responseOutcome === 'clarify') && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                    <span className="flex items-center gap-1.5">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {msg.responseOutcome === 'clarify'
                          ? 'در صورت نیاز به شفاف‌سازی بیشتر یا بررسی موردی می‌توانید با کارشناس ارتباط بگیرید.'
                          : 'برای بررسی دقیق‌تر می‌توانید گفت‌وگو را به کارشناس ارجاع دهید.'}
                      </span>
                    </span>
                    {msg.escalationOffered && !escalatedToHuman && (
                      <button
                        type="button"
                        onClick={handleHumanHandoff}
                        className="font-semibold text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        ثبت تیکت و ارتباط با کارشناس
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!hasCustomerTurns && !sending && !restoring && (
          <div className="pt-2 space-y-2">
            <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span>پرسش‌های پیشنهادی برای شروع سریع:</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {starterPrompts.map((promptText) => (
                <button
                  key={promptText}
                  type="button"
                  onClick={() => void sendText(promptText)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:border-slate-300 hover:bg-slate-100 transition-colors cursor-pointer text-right"
                >
                  {promptText}
                </button>
              ))}
            </div>
          </div>
        )}

        {sending && (
          <div className="flex justify-end">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600 flex items-center gap-2">
              <Loader2 className={`h-3.5 w-3.5 animate-spin ${iconColorClass}`} />
              <span>در حال بررسی و تهیه پاسخ...</span>
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
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <span className="leading-relaxed">
              {convertedTicketRef
                ? authenticatedCustomer
                  ? `تیکت پشتیبانی با کد ${convertedTicketRef.referenceCode} ثبت شد و در صف کارشناس دپارتمان است.`
                  : `تیکت شما با کد ${convertedTicketRef.referenceCode} ثبت و برای کارشناس ارسال شد. برای مشاهده پاسخ کارشناس، با کد ملی و رمز عبور وارد «پیگیری تیکت من» شوید.`
                : 'این گفت‌وگو با حفظ تاریخچه در صف کارشناس دپارتمان قرار گرفت.'}
            </span>
            {convertedTicketRef && authenticatedCustomer && onOpenConvertedTicket ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onOpenConvertedTicket(convertedTicketRef.id)}
              >
                <Ticket className="h-3.5 w-3.5" />
                <span>مشاهده تیکت من</span>
              </Button>
            ) : onOpenPortalTracking ? (
              <Button
                type="button"
                size="sm"
                onClick={onOpenPortalTracking}
              >
                <Ticket className="h-3.5 w-3.5" />
                <span>تأیید هویت و مشاهده تیکت‌ها</span>
              </Button>
            ) : null}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendText(input);
              }
            }}
            rows={2}
            placeholder={`پیام خود را برای «${department.nameFa}» بنویسید... (Enter برای ارسال)`}
            className="flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
          <Button
            type="submit"
            disabled={sending || input.trim().length < 2}
            className="h-10"
          >
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
  );
}

export function DepartmentChatDialog({
  department,
  themeAccent = 'blue',
  authenticatedCustomer = null,
  guestIdentity,
  onGuestIdentityChange,
  onClose,
  onOpenPortalTracking,
  onOpenConvertedTicket,
}: {
  department: PublicDepartmentCard | null;
  themeAccent?: ThemeAccentPreset;
  authenticatedCustomer?: VerifiedCustomerDto | null;
  guestIdentity?: GuestIdentityDraft;
  onGuestIdentityChange?: (next: GuestIdentityDraft) => void;
  onClose: () => void;
  onOpenPortalTracking?: () => void;
  onOpenConvertedTicket?: (ticketId: string) => void;
}) {
  return (
    <Dialog
      open={Boolean(department)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        {department && (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{department.nameFa}</DialogTitle>
              <DialogDescription>
                پنجره گفت‌وگو با دپارتمان {department.nameFa}
              </DialogDescription>
            </DialogHeader>
            <DepartmentConversationPanel
              key={department.id}
              department={department}
              themeAccent={themeAccent}
              variant="dialog"
              authenticatedCustomer={authenticatedCustomer}
              guestIdentity={guestIdentity}
              onGuestIdentityChange={onGuestIdentityChange}
              onOpenPortalTracking={onOpenPortalTracking}
              onOpenConvertedTicket={onOpenConvertedTicket}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
