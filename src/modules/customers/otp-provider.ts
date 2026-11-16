import { logger } from '@/src/core/logging/logger.ts';

export type OtpDeliveryChannel = 'sms_webhook' | 'dev_mock';

export interface OtpDispatchPayload {
  challengeId: string;
  fullName: string;
  phone: string | null;
  code: string;
  purpose: string;
}

export interface OtpDispatchResult {
  channel: OtpDeliveryChannel;
  /**
   * Only populated outside production when OTP_PROVIDER=dev_mock so local
   * testing and verification workflows can complete OTP challenges without
   * sending SMS messages. Always undefined in production.
   */
  devPreviewCode?: string;
}

export function resolveConfiguredOtpMode(): 'sms_webhook' | 'dev_mock' | 'disabled' {
  const configured = (process.env.OTP_PROVIDER || '').trim().toLowerCase();
  if (configured === 'sms_webhook') return 'sms_webhook';
  if (configured === 'disabled') return 'disabled';
  if (configured === 'dev_mock') {
    return process.env.NODE_ENV === 'production' ? 'disabled' : 'dev_mock';
  }
  // Safe default: dev_mock in dev/test, disabled in prod until sms_webhook configured
  return process.env.NODE_ENV === 'production' ? 'disabled' : 'dev_mock';
}

export async function dispatchCustomerOtp(
  payload: OtpDispatchPayload
): Promise<OtpDispatchResult> {
  const mode = resolveConfiguredOtpMode();

  if (mode === 'disabled') {
    throw new Error('OTP_PROVIDER_DISABLED_IN_PRODUCTION');
  }

  if (mode === 'sms_webhook') {
    const webhookUrl = (process.env.OTP_SMS_WEBHOOK_URL || '').trim();
    if (!webhookUrl) {
      throw new Error('OTP_WEBHOOK_NOT_CONFIGURED');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = (process.env.OTP_SMS_API_KEY || '').trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        challengeId: payload.challengeId,
        recipientName: payload.fullName,
        phone: payload.phone,
        code: payload.code,
        purpose: payload.purpose,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      logger.error('otp.sms_webhook_failed', {
        status: res.status,
        challengeId: payload.challengeId,
      });
      throw new Error('OTP_DELIVERY_FAILED');
    }

    return { channel: 'sms_webhook' };
  }

  // Development/testing mock delivery ONLY (blocked above in NODE_ENV=production)
  logger.info('otp.dev_mock_dispatched', {
    challengeId: payload.challengeId,
    purpose: payload.purpose,
  });

  return {
    channel: 'dev_mock',
    devPreviewCode: process.env.NODE_ENV === 'production' ? undefined : payload.code,
  };
}
