import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { logger } from '@/src/core/logging/logger.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import {
  SHARED_FILE_EXTENSION_CATALOG,
  type SupportedSharedFileExtension,
} from './schemas.ts';

export interface ValidatedSharedFilePayload {
  originalFilename: string;
  extension: SupportedSharedFileExtension;
  mimeType: string;
  byteSize: number;
  sha256: string;
  scanStatus: 'skipped' | 'clean';
  buffer: Buffer;
}

const ALL_CATALOG_SET = new Set<string>(SHARED_FILE_EXTENSION_CATALOG);

export function sanitizeSharedFilename(filename: string): string {
  const base = path
    .basename(filename || 'file')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_');
  const trimmed = base.trim() || 'file';
  return trimmed.slice(0, 140);
}

function hasExecutableOrHtmlHeader(buffer: Buffer): boolean {
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    // PE/DOS executable (MZ)
    return true;
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    // ELF binary
    return true;
  }
  if (buffer.subarray(0, 2).toString('utf8') === '#!') {
    // Shell/script shebang
    return true;
  }
  const head = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.startsWith('<script') ||
    head.startsWith('<svg')
  ) {
    return true;
  }
  return false;
}

function detectAndVerifyFileSignature(
  filename: string,
  buffer: Buffer,
  allowedExtensions: Set<SupportedSharedFileExtension>
): { extension: SupportedSharedFileExtension; mimeType: string } {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, '');

  if (!ALL_CATALOG_SET.has(ext)) {
    throw new Error('UNSUPPORTED_FILE_TYPE');
  }
  const typedExt = ext as SupportedSharedFileExtension;
  if (!allowedExtensions.has(typedExt)) {
    throw new Error('UNSUPPORTED_FILE_TYPE');
  }

  if (hasExecutableOrHtmlHeader(buffer)) {
    throw new Error('INVALID_FILE_SIGNATURE');
  }

  if (typedExt === 'png') {
    const valid =
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    if (!valid) throw new Error('INVALID_FILE_SIGNATURE');
    return { extension: 'png', mimeType: 'image/png' };
  }

  if (typedExt === 'jpg' || typedExt === 'jpeg') {
    const valid =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
    if (!valid) throw new Error('INVALID_FILE_SIGNATURE');
    return { extension: typedExt, mimeType: 'image/jpeg' };
  }

  if (typedExt === 'webp') {
    const valid =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!valid) throw new Error('INVALID_FILE_SIGNATURE');
    return { extension: 'webp', mimeType: 'image/webp' };
  }

  if (typedExt === 'pdf') {
    const valid =
      buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (!valid) throw new Error('INVALID_FILE_SIGNATURE');
    return { extension: 'pdf', mimeType: 'application/pdf' };
  }

  if (typedExt === 'docx' || typedExt === 'xlsx') {
    const valid =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
      (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);
    if (!valid) throw new Error('INVALID_FILE_SIGNATURE');
    return {
      extension: typedExt,
      mimeType:
        typedExt === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // txt, md, csv: reject binary NUL bytes
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    if (buffer[i] === 0x00) {
      throw new Error('INVALID_FILE_SIGNATURE');
    }
  }

  return {
    extension: typedExt,
    mimeType:
      typedExt === 'md'
        ? 'text/markdown; charset=utf-8'
        : typedExt === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'text/plain; charset=utf-8',
  };
}

async function scanBufferWithOptionalAv(buffer: Buffer): Promise<'skipped' | 'clean'> {
  const mode = (process.env.AV_SCANNER_MODE || 'disabled').trim().toLowerCase();
  if (mode !== 'clamav') {
    return 'skipped';
  }

  const host = (process.env.CLAMAV_HOST || '127.0.0.1').trim();
  const port = Number(process.env.CLAMAV_PORT || 3310);

  let response: string;
  try {
    response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const chunks: Buffer[] = [];
      socket.setTimeout(10000);

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const lenBuf = Buffer.allocUnsafe(4);
        lenBuf.writeUInt32BE(buffer.length, 0);
        socket.write(lenBuf);
        socket.write(buffer);
        socket.write(Buffer.alloc(4, 0));
      });

      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('AV_SCAN_UNAVAILABLE'));
      });
      socket.on('error', () => reject(new Error('AV_SCAN_UNAVAILABLE')));
    });
  } catch {
    throw new Error('AV_SCAN_UNAVAILABLE');
  }

  if (response.includes('FOUND')) {
    logger.warn('files.malware_detected', { clamavResponse: response.trim() });
    throw new Error('MALWARE_DETECTED');
  }
  return 'clean';
}

export async function validateSharedFileUpload(params: {
  filename: string;
  buffer: Buffer;
  maxUploadSizeMb: number;
  allowedExtensions: SupportedSharedFileExtension[];
}): Promise<ValidatedSharedFilePayload> {
  if (!params.buffer || params.buffer.length === 0) {
    throw new Error('EMPTY_FILE');
  }

  const maxBytes = Math.max(1, params.maxUploadSizeMb) * 1024 * 1024;
  if (params.buffer.length > maxBytes) {
    throw new Error('FILE_TOO_LARGE');
  }

  const sanitizedName = sanitizeSharedFilename(params.filename);
  const detected = detectAndVerifyFileSignature(
    sanitizedName,
    params.buffer,
    new Set(params.allowedExtensions)
  );
  const scanStatus = await scanBufferWithOptionalAv(params.buffer);
  const sha256 = createHash('sha256').update(params.buffer).digest('hex');

  return {
    originalFilename: sanitizedName,
    extension: detected.extension,
    mimeType: detected.mimeType,
    byteSize: params.buffer.length,
    sha256,
    scanStatus,
    buffer: params.buffer,
  };
}

export function buildSharedFileStorageKey(
  departmentId: string,
  extension: SupportedSharedFileExtension
): string {
  const safeDept = departmentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `files/${safeDept}/${yyyy}/${mm}/${randomUUID()}.${extension}`;
}

export async function persistSharedFileBuffer(params: {
  departmentId: string;
  payload: ValidatedSharedFilePayload;
}): Promise<string> {
  const storageKey = buildSharedFileStorageKey(
    params.departmentId,
    params.payload.extension
  );
  await getStorageDriver().put(storageKey, params.payload.buffer);
  return storageKey;
}
