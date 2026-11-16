import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { InternalAiProviderRuntimeConfig } from './settings.ts';

export interface AiGenerationRequest {
  systemInstruction: string;
  userContent: string;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature: number;
}

export interface AiGenerationResult {
  text: string;
  modelName: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface AiConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  modelChecked: string;
  messageFa: string;
}

export interface AiProviderAdapter {
  generateGroundedReply(req: AiGenerationRequest): Promise<AiGenerationResult>;
  generateEmbedding(text: string, timeoutMs?: number): Promise<number[] | null>;
  testConnection(): Promise<AiConnectionTestResult>;
}

const GEMINI_4_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-4-argon',
  'gemini-4-carbon',
]);

export class GeminiProviderAdapter implements AiProviderAdapter {
  private readonly apiKey: string;
  private readonly chatModel: string;
  private readonly embeddingModel: string | null;
  private readonly timeoutMs: number;

  constructor(config: InternalAiProviderRuntimeConfig) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY?.trim() || '';
    this.chatModel = config.chatModel || 'gemini-4-hydrogen';
    this.embeddingModel = config.embeddingModel || null;
    this.timeoutMs = config.timeoutMs || 25000;
  }

  private createClient() {
    if (!this.apiKey) {
      throw new Error('AI_API_KEY_MISSING');
    }
    return new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
        timeout: this.timeoutMs,
      },
    });
  }

  async generateGroundedReply(req: AiGenerationRequest): Promise<AiGenerationResult> {
    const ai = this.createClient();
    const isGemini4 = GEMINI_4_MODELS.has(this.chatModel);

    const response = await ai.models.generateContent({
      model: this.chatModel,
      contents: req.userContent,
      config: {
        systemInstruction: req.systemInstruction,
        ...(isGemini4
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {
              temperature: req.temperature,
              maxOutputTokens: req.maxOutputTokens,
            }),
      },
    });

    const text = (response.text || '').trim();
    if (!text) {
      throw new Error('AI_EMPTY_RESPONSE');
    }

    return {
      text,
      modelName: this.chatModel,
      promptTokens: response.usageMetadata?.promptTokenCount ?? null,
      completionTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    };
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.embeddingModel || !this.apiKey) return null;
    try {
      const ai = this.createClient();
      const result = await ai.models.embedContent({
        model: this.embeddingModel,
        contents: text,
      });
      return result.embeddings?.[0]?.values ?? null;
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<AiConnectionTestResult> {
    const started = Date.now();
    try {
      const ai = this.createClient();
      const isGemini4 = GEMINI_4_MODELS.has(this.chatModel);
      const response = await ai.models.generateContent({
        model: this.chatModel,
        contents: 'فقط کلمه OK را برگردان.',
        config: {
          ...(isGemini4
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : { maxOutputTokens: 32, temperature: 0 }),
        },
      });
      const latencyMs = Date.now() - started;
      const reply = (response.text || '').trim();
      if (!reply) {
        return {
          ok: false,
          latencyMs,
          modelChecked: this.chatModel,
          messageFa: 'پاسخ خالی از سرویس Gemini دریافت شد.',
        };
      }
      return {
        ok: true,
        latencyMs,
        modelChecked: this.chatModel,
        messageFa: `اتصال به مدل ${this.chatModel} با موفقیت برقرار شد.`,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const msg = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      if (msg === 'AI_API_KEY_MISSING') {
        return {
          ok: false,
          latencyMs,
          modelChecked: this.chatModel,
          messageFa: 'کلید API برای سرویس Gemini تنظیم نشده است.',
        };
      }
      return {
        ok: false,
        latencyMs,
        modelChecked: this.chatModel,
        messageFa: 'برقراری ارتباط با سرویس Gemini ناموفق بود. تنظیمات مدل و کلید را بررسی کنید.',
      };
    }
  }
}

export class OpenAiCompatibleAdapter implements AiProviderAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly chatModel: string;
  private readonly embeddingModel: string | null;
  private readonly timeoutMs: number;

  constructor(config: InternalAiProviderRuntimeConfig) {
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.chatModel = config.chatModel;
    this.embeddingModel = config.embeddingModel || null;
    this.timeoutMs = config.timeoutMs || 25000;
  }

  async generateGroundedReply(req: AiGenerationRequest): Promise<AiGenerationResult> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('AI_PROVIDER_NOT_CONFIGURED');
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.chatModel,
        temperature: req.temperature,
        max_tokens: req.maxOutputTokens,
        messages: [
          { role: 'system', content: req.systemInstruction },
          { role: 'user', content: req.userContent },
        ],
      }),
      signal: AbortSignal.timeout(req.timeoutMs || this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`AI_HTTP_${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      throw new Error('AI_EMPTY_RESPONSE');
    }

    return {
      text,
      modelName: this.chatModel,
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
    };
  }

  async generateEmbedding(text: string, timeoutMs?: number): Promise<number[] | null> {
    if (!this.embeddingModel || !this.baseUrl || !this.apiKey) return null;
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: text,
        }),
        signal: AbortSignal.timeout(timeoutMs || this.timeoutMs),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      return data.data?.[0]?.embedding ?? null;
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<AiConnectionTestResult> {
    const started = Date.now();
    if (!this.baseUrl || !this.apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        modelChecked: this.chatModel,
        messageFa: 'آدرس Base URL یا کلید API تنظیم نشده است.',
      };
    }

    try {
      const result = await this.generateGroundedReply({
        systemInstruction: 'Reply strictly with OK.',
        userContent: 'OK',
        timeoutMs: Math.min(this.timeoutMs, 15000),
        maxOutputTokens: 16,
        temperature: 0,
      });
      return {
        ok: Boolean(result.text),
        latencyMs: Date.now() - started,
        modelChecked: this.chatModel,
        messageFa: `اتصال به سرویس ${this.baseUrl} و مدل ${this.chatModel} با موفقیت تایید شد.`,
      };
    } catch (err) {
      const code = err instanceof Error ? err.message : 'CONNECTION_FAILED';
      return {
        ok: false,
        latencyMs: Date.now() - started,
        modelChecked: this.chatModel,
        messageFa: `اتصال ناموفق بود (${code}). نشانی API، کلید و نام مدل را بررسی کنید.`,
      };
    }
  }
}

export function createAiProviderAdapter(
  config: InternalAiProviderRuntimeConfig
): AiProviderAdapter {
  if (config.providerType === 'openai_compatible') {
    return new OpenAiCompatibleAdapter(config);
  }
  return new GeminiProviderAdapter(config);
}
