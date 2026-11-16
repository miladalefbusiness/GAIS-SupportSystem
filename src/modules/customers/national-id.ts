import { getAppEncryptionKey, getAppHmacKey } from '@/src/core/config/env.ts';
import {
  computeKeyedHmac,
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '@/src/core/security/crypto.ts';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const pIdx = PERSIAN_DIGITS.indexOf(ch);
    if (pIdx !== -1) {
      out += String(pIdx);
      continue;
    }
    const aIdx = ARABIC_DIGITS.indexOf(ch);
    if (aIdx !== -1) {
      out += String(aIdx);
      continue;
    }
    out += ch;
  }
  return out;
}

export interface NationalIdValidationResult {
  valid: boolean;
  normalized: string;
  reason?: string;
}

/**
 * Validates an Iranian 10-digit National ID (کد ملی) using the official
 * weighted modulo-11 check digit algorithm and rejects all-identical digits.
 */
export function validateIranianNationalId(raw: string): NationalIdValidationResult {
  const normalized = normalizeDigits(raw).replace(/[\s\-_]/g, '').trim();

  if (!/^\d{10}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      reason: 'کد ملی باید دقیقاً ۱۰ رقم باشد.',
    };
  }

  if (/^(\d)\1{9}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      reason: 'کد ملی واردشده نامعتبر است (ارقام تکراری مجاز نیستند).',
    };
  }

  const digits = Array.from(normalized, (c) => Number(c));
  const checkDigit = digits[9];
  let weightedSum = 0;
  for (let i = 0; i < 9; i++) {
    weightedSum += digits[i] * (10 - i);
  }
  const remainder = weightedSum % 11;
  const isValid =
    remainder < 2 ? checkDigit === remainder : checkDigit === 11 - remainder;

  if (!isValid) {
    return {
      valid: false,
      normalized,
      reason: 'رقم کنترل کد ملی صحیح نیست. لطفاً کد ملی معتبر وارد کنید.',
    };
  }

  return { valid: true, normalized };
}

export function computeNationalIdHmac(normalizedNationalId: string): string {
  return computeKeyedHmac(`nid:v1:${normalizedNationalId}`, getAppHmacKey());
}

export function encryptNationalId(normalizedNationalId: string): string {
  return encryptSensitiveValue(normalizedNationalId, getAppEncryptionKey());
}

export function decryptNationalId(encryptedPayload: string): string {
  return decryptSensitiveValue(encryptedPayload, getAppEncryptionKey());
}

export function normalizeAndValidateIranianMobile(raw?: string | null): {
  normalized: string | null;
  masked: string | null;
  encrypted: string | null;
} {
  if (!raw || !raw.trim()) {
    return { normalized: null, masked: null, encrypted: null };
  }
  let cleaned = normalizeDigits(raw).replace(/[\s\-()]/g, '').trim();
  if (cleaned.startsWith('+98')) {
    cleaned = `0${cleaned.slice(3)}`;
  } else if (cleaned.startsWith('0098')) {
    cleaned = `0${cleaned.slice(4)}`;
  }
  if (!/^09\d{9}$/.test(cleaned)) {
    throw new Error('INVALID_PHONE_NUMBER');
  }
  const masked = `${cleaned.slice(0, 4)}••••${cleaned.slice(8)}`;
  const encrypted = encryptSensitiveValue(cleaned, getAppEncryptionKey());
  return { normalized: cleaned, masked, encrypted };
}
