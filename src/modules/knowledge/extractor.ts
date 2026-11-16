import { createHash } from 'node:crypto';
import path from 'node:path';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';

export type SupportedKbExtension = 'pdf' | 'docx' | 'txt' | 'md';

const ALLOWED_EXTENSIONS = new Set<SupportedKbExtension>(['pdf', 'docx', 'txt', 'md']);

export interface ExtractedDocumentResult {
  extension: SupportedKbExtension;
  detectedMimeType: string;
  sha256: string;
  extractedText: string;
}

export function getAllowedExtension(filename: string): SupportedKbExtension | null {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
  if (ALLOWED_EXTENSIONS.has(ext as SupportedKbExtension)) {
    return ext as SupportedKbExtension;
  }
  return null;
}

function hasPdfMagic(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('ascii') === '%PDF-';
}

function hasZipMagic(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
    (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)
  );
}

function isLikelyUtf8Text(buf: Buffer): boolean {
  // Reject files containing NUL bytes (binary/executable payloads disguised as txt/md)
  for (let i = 0; i < Math.min(buf.length, 8192); i++) {
    if (buf[i] === 0x00) return false;
  }
  return true;
}

export async function validateAndExtractDocument(params: {
  filename: string;
  buffer: Buffer;
  maxBytes: number;
}): Promise<ExtractedDocumentResult> {
  if (!params.buffer || params.buffer.length === 0) {
    throw new Error('EMPTY_FILE');
  }
  if (params.buffer.length > params.maxBytes) {
    throw new Error('FILE_TOO_LARGE');
  }

  const ext = getAllowedExtension(params.filename);
  if (!ext) {
    throw new Error('UNSUPPORTED_FILE_TYPE');
  }

  const sha256 = createHash('sha256').update(params.buffer).digest('hex');

  if (ext === 'pdf') {
    if (!hasPdfMagic(params.buffer)) {
      throw new Error('INVALID_FILE_SIGNATURE');
    }
    const result = await extractText(new Uint8Array(params.buffer), {
      mergePages: true,
    });
    const text = (Array.isArray(result.text) ? result.text.join('\n\n') : result.text || '').trim();
    if (!text) {
      throw new Error('EXTRACTED_TEXT_EMPTY');
    }
    return {
      extension: 'pdf',
      detectedMimeType: 'application/pdf',
      sha256,
      extractedText: text,
    };
  }

  if (ext === 'docx') {
    if (!hasZipMagic(params.buffer)) {
      throw new Error('INVALID_FILE_SIGNATURE');
    }
    const result = await mammoth.extractRawText({ buffer: params.buffer });
    const text = (result.value || '').trim();
    if (!text) {
      throw new Error('EXTRACTED_TEXT_EMPTY');
    }
    return {
      extension: 'docx',
      detectedMimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sha256,
      extractedText: text,
    };
  }

  if (!isLikelyUtf8Text(params.buffer)) {
    throw new Error('INVALID_FILE_SIGNATURE');
  }

  const text = params.buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!text) {
    throw new Error('EXTRACTED_TEXT_EMPTY');
  }

  return {
    extension: ext,
    detectedMimeType: ext === 'md' ? 'text/markdown' : 'text/plain',
    sha256,
    extractedText: text,
  };
}
