'use client';

import { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  Sparkles,
  Wifi,
  XCircle,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toPersianDigits } from '@/src/lib/jalali';
import type { SafeAiProviderView } from '@/src/modules/ai/settings';

export interface DepartmentAiConfigItem {
  departmentId: string;
  departmentNameFa: string;
  slug: string;
  isActive: boolean;
  aiEnabled: boolean;
  welcomeMessageFa: string;
  fallbackMessageFa: string;
  autoOfferEscalation: boolean;
  minConfidenceScore: number;
  maxTurnsPerSession: number;
  allowAiDuringHumanHandoff: boolean;
  collectionIds: string[];
}

export interface CollectionOptionItem {
  id: string;
  nameFa: string;
  scope: string;
  isActive: boolean;
}

export function AiSettingsManager({
  initialProvider,
  initialDepartments,
  collections,
}: {
  initialProvider: SafeAiProviderView;
  initialDepartments: DepartmentAiConfigItem[];
  collections: CollectionOptionItem[];
}) {
  const router = useRouter();

  const [provider, setProvider] = useState<SafeAiProviderView>(initialProvider);
  const [providerType, setProviderType] = useState<'gemini' | 'openai_compatible'>(
    initialProvider.providerType
  );
  const [providerName, setProviderName] = useState(initialProvider.providerName);
  const [baseUrl, setBaseUrl] = useState(initialProvider.baseUrl || '');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [chatModel, setChatModel] = useState(initialProvider.chatModel);
  const [embeddingModel, setEmbeddingModel] = useState(
    initialProvider.embeddingModel || ''
  );
  const [timeoutMs, setTimeoutMs] = useState(String(initialProvider.timeoutMs));
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    String(initialProvider.maxOutputTokens)
  );
  const [temperature, setTemperature] = useState(initialProvider.temperature);
  const [globalEnabled, setGlobalEnabled] = useState(initialProvider.globalEnabled);

  const [savingGlobal, setSavingGlobal] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [lastTestBanner, setLastTestBanner] = useState<{
    ok: boolean;
    messageFa: string;
    latencyMs?: number;
  } | null>(
    initialProvider.lastTestMessage
      ? {
          ok: Boolean(initialProvider.lastTestOk),
          messageFa: initialProvider.lastTestMessage,
        }
      : null
  );

  const [deptConfigs, setDeptConfigs] =
    useState<DepartmentAiConfigItem[]>(initialDepartments);
  const [savingDeptId, setSavingDeptId] = useState<string | null>(null);

  async function handleSaveGlobal(e: React.FormEvent) {
    e.preventDefault();
    setSavingGlobal(true);
    try {
      const res = await fetch('/api/admin/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerType,
          providerName: providerName.trim(),
          baseUrl: baseUrl.trim() || null,
          apiKey: apiKeyInput.trim() || undefined,
          clearApiKey,
          chatModel: chatModel.trim(),
          embeddingModel: embeddingModel.trim() || null,
          timeoutMs: Number(timeoutMs) || 25000,
          maxOutputTokens: Number(maxOutputTokens) || 1024,
          temperature: temperature.trim() || '0.1',
          globalEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'ذخیره تنظیمات ارائه‌دهنده ناموفق بود.');
        return;
      }

      setProvider(data.provider);
      setApiKeyInput('');
      setClearApiKey(false);
      toast.success('تنظیمات ارائه‌دهنده هوش مصنوعی با رمزنگاری امن ذخیره شد.');
      router.refresh();
    } catch {
      toast.error('خطای شبکه هنگام ذخیره تنظیمات.');
    } finally {
      setSavingGlobal(false);
    }
  }

  async function handleTestConnection() {
    setTestingConn(true);
    try {
      const res = await fetch('/api/admin/ai/test-connection', {
        method: 'POST',
      });
      const data = await res.json();
      setLastTestBanner({
        ok: Boolean(data.ok),
        messageFa: data.messageFa || 'آزمایش انجام شد.',
        latencyMs: data.latencyMs,
      });
      if (data.ok) {
        toast.success('اتصال به سرویس هوش مصنوعی با موفقیت برقرار شد.');
      } else {
        toast.error(data.messageFa || 'اتصال برقرار نشد.');
      }
      router.refresh();
    } catch {
      toast.error('خطای ارتباط در آزمون اتصال.');
    } finally {
      setTestingConn(false);
    }
  }

  function updateLocalDept(
    departmentId: string,
    patch: Partial<DepartmentAiConfigItem>
  ) {
    setDeptConfigs((prev) =>
      prev.map((d) => (d.departmentId === departmentId ? { ...d, ...patch } : d))
    );
  }

  function toggleDeptCollection(departmentId: string, colId: string) {
    setDeptConfigs((prev) =>
      prev.map((d) => {
        if (d.departmentId !== departmentId) return d;
        const exists = d.collectionIds.includes(colId);
        return {
          ...d,
          collectionIds: exists
            ? d.collectionIds.filter((c) => c !== colId)
            : [...d.collectionIds, colId],
        };
      })
    );
  }

  async function handleSaveDept(dept: DepartmentAiConfigItem) {
    setSavingDeptId(dept.departmentId);
    try {
      const res = await fetch(`/api/admin/ai/departments/${dept.departmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiEnabled: dept.aiEnabled,
          welcomeMessageFa: dept.welcomeMessageFa,
          fallbackMessageFa: dept.fallbackMessageFa,
          autoOfferEscalation: dept.autoOfferEscalation,
          minConfidenceScore: Number(dept.minConfidenceScore) || 25,
          maxTurnsPerSession: Number(dept.maxTurnsPerSession) || 20,
          allowAiDuringHumanHandoff: dept.allowAiDuringHumanHandoff,
          collectionIds: dept.collectionIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'ذخیره تنظیمات دپارتمان ناموفق بود.');
        return;
      }
      toast.success(`تنظیمات هوش مصنوعی «${dept.departmentNameFa}» ذخیره شد.`);
      router.refresh();
    } catch {
      toast.error('خطای شبکه در ذخیره تنظیمات دپارتمان.');
    } finally {
      setSavingDeptId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">
          تنظیمات هوش مصنوعی و ارائه‌دهنده مدل
        </h1>
        <p className="text-sm text-slate-600">
          پیکربندی Google Gemini یا سرویس‌های سازگار با OpenAI، رمزنگاری کلید API و تنظیم سیاست پاسخگویی هر دپارتمان
        </p>
      </div>

      {/* GLOBAL AI PROVIDER SETTINGS */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-700" />
                <span>پیکربندی ارائه‌دهنده مرکزی هوش مصنوعی</span>
              </CardTitle>
              <CardDescription className="mt-1">
                کلید API با الگوریتم AES-256-GCM در پایگاه داده رمزنگاری می‌شود و هرگز به مرورگر بازگردانده نمی‌شود.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testingConn}
              onClick={handleTestConnection}
            >
              {testingConn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4" />
              )}
              <span>آزمون اتصال (Test Connection)</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {lastTestBanner && (
            <div
              className={`rounded-lg border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
                lastTestBanner.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              <span className="flex items-center gap-2">
                {lastTestBanner.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" />
                )}
                <span>{lastTestBanner.messageFa}</span>
              </span>
              {lastTestBanner.latencyMs !== undefined && (
                <span className="tabular-nums whitespace-nowrap">
                  {toPersianDigits(lastTestBanner.latencyMs)} میلی‌ثانیه
                </span>
              )}
            </div>
          )}

          <form onSubmit={handleSaveGlobal} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="provider-type">نوع ارائه‌دهنده</Label>
                <select
                  id="provider-type"
                  value={providerType}
                  onChange={(e) => {
                    const nextType = e.target.value as 'gemini' | 'openai_compatible';
                    setProviderType(nextType);
                    if (nextType === 'gemini') {
                      if (providerName === 'OpenAI-Compatible API') {
                        setProviderName('Google Gemini');
                      }
                      if (!chatModel.startsWith('gemini')) {
                        setChatModel('gemini-4-hydrogen');
                      }
                    } else {
                      if (providerName === 'Google Gemini') {
                        setProviderName('OpenAI-Compatible API');
                      }
                      if (chatModel.startsWith('gemini')) {
                        setChatModel('gpt-4o-mini');
                      }
                    }
                  }}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <option value="gemini">Google Gemini (@google/genai)</option>
                  <option value="openai_compatible">
                    OpenAI-Compatible API (vLLM / Ollama / OpenRouter / AvalAI / ...)
                  </option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="provider-name">عنوان نمایشی ارائه‌دهنده</Label>
                <Input
                  id="provider-name"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  required
                />
              </div>
            </div>

            {providerType === 'openai_compatible' && (
              <div className="space-y-1.5">
                <Label htmlFor="base-url">نشانی پایه API (Base URL)</Label>
                <Input
                  id="base-url"
                  dir="ltr"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  required
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="chat-model">نام مدل گفت‌وگو (Chat Model)</Label>
                <Input
                  id="chat-model"
                  dir="ltr"
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value)}
                  placeholder={
                    providerType === 'gemini' ? 'gemini-4-hydrogen' : 'gpt-4o-mini'
                  }
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="embed-model">مدل Embedding (اختیاری)</Label>
                <Input
                  id="embed-model"
                  dir="ltr"
                  value={embeddingModel}
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                  placeholder={
                    providerType === 'gemini'
                      ? 'gemini-embedding-001'
                      : 'text-embedding-3-small'
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="api-key" className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>کلید API (برای حفظ کلید فعلی خالی بگذارید)</span>
                </span>
                <span className="text-xs font-normal text-slate-500 font-[family-name:var(--font-mono)]">
                  {provider.hasStoredApiKey
                    ? `ذخیره‌شده: ${provider.apiKeyHint}`
                    : provider.hasEnvGeminiKey && providerType === 'gemini'
                    ? 'فعال از متغیر محیطی سرور (GEMINI_API_KEY)'
                    : 'کلید تنظیم نشده'}
                </span>
              </Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showApiKey ? 'text' : 'password'}
                  dir="ltr"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="کلید جدید را در صورت نیاز وارد کنید..."
                  autoComplete="new-password"
                  className="pl-10 text-left"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={showApiKey ? 'مخفی کردن کلید API' : 'نمایش کلید API'}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {provider.hasStoredApiKey && (
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={clearApiKey}
                    onChange={(e) => setClearApiKey(e.target.checked)}
                  />
                  <span>حذف کلید رمزنگاری‌شده فعلی هنگام ذخیره</span>
                </label>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="timeout-ms">زمان انقضا (میلی‌ثانیه)</Label>
                <Input
                  id="timeout-ms"
                  type="number"
                  min={3000}
                  max={60000}
                  dir="ltr"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-tokens">حداکثر توکن پاسخ</Label>
                <Input
                  id="max-tokens"
                  type="number"
                  min={128}
                  max={8192}
                  dir="ltr"
                  value={maxOutputTokens}
                  onChange={(e) => setMaxOutputTokens(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="temperature">دما (Temperature، ۰ تا ۱)</Label>
                <Input
                  id="temperature"
                  dir="ltr"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-slate-200 pt-4">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={globalEnabled}
                  onChange={(e) => setGlobalEnabled(e.target.checked)}
                />
                <span>پاسخگویی هوشمند در سطح کل سازمان فعال باشد</span>
              </label>

              <Button type="submit" disabled={savingGlobal}>
                {savingGlobal ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>ذخیره تنظیمات مرکزی</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* PER-DEPARTMENT AI POLICIES */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-700" />
            <span>سیاست‌های هوشمند و مجموعه‌های دانش هر دپارتمان</span>
          </h2>
          <p className="text-xs text-slate-600">
            هر دپارتمان فقط به اسناد عمومی، اسناد مستقیم خود و مجموعه‌های متصل در این بخش دسترسی دارد.
          </p>
        </div>

        <div className="space-y-4">
          {deptConfigs.map((dept) => (
            <Card key={dept.departmentId}>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{dept.departmentNameFa}</CardTitle>
                    <CardDescription className="font-[family-name:var(--font-mono)] text-xs">
                      /{dept.slug} · {dept.isActive ? 'دپارتمان فعال' : 'دپارتمان غیرفعال'}
                    </CardDescription>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    disabled={savingDeptId === dept.departmentId}
                    onClick={() => handleSaveDept(dept)}
                  >
                    {savingDeptId === dept.departmentId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span>ذخیره تنظیمات دپارتمان</span>
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-5 text-xs text-slate-800">
                  <label className="flex items-center gap-2 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={dept.aiEnabled}
                      onChange={(e) =>
                        updateLocalDept(dept.departmentId, {
                          aiEnabled: e.target.checked,
                        })
                      }
                    />
                    <span>دستیار هوشمند فعال باشد</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dept.autoOfferEscalation}
                      onChange={(e) =>
                        updateLocalDept(dept.departmentId, {
                          autoOfferEscalation: e.target.checked,
                        })
                      }
                    />
                    <span>پیشنهاد خودکار ارتباط با اپراتور هنگام عدم یافتن پاسخ</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dept.allowAiDuringHumanHandoff}
                      onChange={(e) =>
                        updateLocalDept(dept.departmentId, {
                          allowAiDuringHumanHandoff: e.target.checked,
                        })
                      }
                    />
                    <span>ادامه پاسخگویی AI پس از ارجاع به اپراتور (توصیه نمی‌شود)</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>پیام خوشامدگویی دپارتمان</Label>
                    <textarea
                      rows={2}
                      value={dept.welcomeMessageFa}
                      onChange={(e) =>
                        updateLocalDept(dept.departmentId, {
                          welcomeMessageFa: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>پیام عدم یافتن پاسخ کافی (Abstain Fallback)</Label>
                    <textarea
                      rows={2}
                      value={dept.fallbackMessageFa}
                      onChange={(e) =>
                        updateLocalDept(dept.departmentId, {
                          fallbackMessageFa: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>
                      حداقل امتیاز اطمینان بازیابی (
                      {toPersianDigits(dept.minConfidenceScore)})
                    </Label>
                    <Input
                      type="number"
                      min={5}
                      max={95}
                      dir="ltr"
                      value={dept.minConfidenceScore}
                      onChange={(e) =>
                        updateLocalDept(dept.departmentId, {
                          minConfidenceScore: Number(e.target.value) || 25,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      سقف پیام خودکار در هر نشست (
                      {toPersianDigits(dept.maxTurnsPerSession)})
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      dir="ltr"
                      value={dept.maxTurnsPerSession}
                      onChange={(e) =>
                        updateLocalDept(dept.departmentId, {
                          maxTurnsPerSession: Number(e.target.value) || 20,
                        })
                      }
                    />
                  </div>
                </div>

                {collections.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>مجموعه‌های دانش متصل به این دپارتمان</Label>
                    <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {collections.map((col) => (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={dept.collectionIds.includes(col.id)}
                            onChange={() =>
                              toggleDeptCollection(dept.departmentId, col.id)
                            }
                          />
                          <span>{col.nameFa}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
