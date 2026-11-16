import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { logger } from '@/src/core/logging/logger.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';

export type SupportedAttachmentExtension =
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'webp'
  | 'pdf'
  | 'docx'
  | 'txt'
  | 'md';

const ALLOWED_EXTENSIONS = new Set<SupportedAttachmentExtension>([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'pdf',
  'docx',
  'txt',
  'md',
]);

export interface ValidatedAttachmentPayload {
  originalFilename: string;
  extension: SupportedAttachmentExtension;
  mimeType: string;
  byteSize: number;
  sha256: string;
  scanStatus: 'skipped' | 'clean';
  buffer: Buffer;
}

export function sanitizeAttachmentFilename(filename: string): string {
  const base = path.basename(filename || 'attachment').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_');
  const trimmed = base.trim() || 'attachment';
  return trimmed.slice(0, 120);
}

function detectExtensionAndValidateMagic(
  filename: string,
  buffer: Buffer
): { extension: SupportedAttachmentExtension; mimeType: string } {
  const ext = path
    .extname(filename)
    .toLowerCase()
    .replace(/^\./, '') as SupportedAttachmentExtension;

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('UNSUPPORTED_ATTACHMENT_TYPE');
  }

  if (ext === 'png') {
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
    if (!valid) throw new Error('INVALID_ATTACHMENT_SIGNATURE');
    return { extension: 'png', mimeType: 'image/png' };
  }

  if (ext === 'jpg' || ext === 'jpeg') {
    const valid =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
    if (!valid) throw new Error('INVALID_ATTACHMENT_SIGNATURE');
    return { extension: ext, mimeType: 'image/jpeg' };
  }

  if (ext === 'webp') {
    const valid =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!valid) throw new Error('INVALID_ATTACHMENT_SIGNATURE');
    return { extension: 'webp', mimeType: 'image/webp' };
  }

  if (ext === 'pdf') {
    const valid = buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (!valid) throw new Error('INVALID_ATTACHMENT_SIGNATURE');
    return { extension: 'pdf', mimeType: 'application/pdf' };
  }

  if (ext === 'docx') {
    const valid =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
      (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);
    if (!valid) throw new Error('INVALID_ATTACHMENT_SIGNATURE');
    return {
      extension: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  // txt or md: reject binary payloads containing NUL bytes
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    if (buffer[i] === 0x00) {
      throw new Error('INVALID_ATTACHMENT_SIGNATURE');
    }
  }
  return {
    extension: ext,
    mimeType: ext === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
  };
}

async function scanBufferWithOptionalAv(buffer: Buffer): Promise<'skipped' | 'clean'> {
  const mode = (process.env.AV_SCANNER_MODE || 'disabled').trim().toLowerCase();
  if (mode !== 'clamav') {
    return 'skipped';
  }

  const host = (process.env.CLAMAV_HOST || '127.0.0.1').trim();
  const port = Number(process.env.CLAMAV_PORT || 3310);

  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks: Buffer[] = [];
    socket.setTimeout(10000);

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const lenBuf = Buffer.allocUnsafe(4);
      lenBuf.writeUInt32BE(buffer.length, 0);
      socket.write(lenBuf);
      socket.write(buffer);
      const endBuf = Buffer.alloc(4, 0);
      socket.write(endBuf);
    });

    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('AV_SCAN_TIMEOUT'));
    });
    socket.on('error', (err) => reject(err));
  });

  if (response.includes('FOUND')) {
    logger.warn('ticket.attachment_malware_detected', { clamavResponse: response.trim() });
    throw new Error('ATTACHMENT_MALWARE_DETECTED');
  }
  return 'clean';
}

export async function validateAttachmentUpload(params: {
  filename: string;
  buffer: Buffer;
  maxUploadSizeMb: number;
}): Promise<ValidatedAttachmentPayload> {
  if (!params.buffer || params.buffer.length === 0) {
    throw new Error('EMPTY_ATTACHMENT');
  }
  const maxBytes = Math.max(1, params.maxUploadSizeMb) * 1024 * 1024;
  if (params.buffer.length > maxBytes) {
    throw new Error('ATTACHMENT_TOO_LARGE');
  }

  const sanitizedName = sanitizeAttachmentFilename(params.filename);
  const detected = detectExtensionAndValidateMagic(sanitizedName, params.buffer);
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

export async function persistValidatedAttachmentBuffer(
  payload: ValidatedAttachmentPayload
): Promise<string> {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const storageKey = `tickets/${yyyy}/${mm}/${randomUUID()}.${payload.extension}`;
  await getStorageDriver().put(storageKey, payload.buffer);
  return storageKey;
}
