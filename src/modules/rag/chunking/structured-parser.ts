import { createHash } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { normalizePersianPreservingStructure } from '../normalizer.ts';
import type {
  ExtractedStructuredDocument,
  StructuredBlock,
  SupportedDocumentFormat,
} from '../types.ts';

const ALLOWED_EXTENSIONS = new Set<SupportedDocumentFormat>([
  'pdf',
  'docx',
  'txt',
  'md',
  'xlsx',
]);

export function getAllowedDocumentFormat(
  filename: string
): SupportedDocumentFormat | null {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
  if (ALLOWED_EXTENSIONS.has(ext as SupportedDocumentFormat)) {
    return ext as SupportedDocumentFormat;
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
  for (let i = 0; i < Math.min(buf.length, 8192); i++) {
    if (buf[i] === 0x00) return false;
  }
  return true;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    });
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim()
  );
}

function isLikelyHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90 || trimmed.length < 3) return false;
  if (/[.؟!؛]$/.test(trimmed)) return false;

  // Persian/English regulatory or structural section headers
  if (
    /^(فصل|بخش|ماده|تبصره|بند|پیوست|جدول|دستورالعمل)\s+[\d۰-۹الف-ی]+/u.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^\d+(?:\.\d+){0,3}[)\].\s-]+\S+/.test(trimmed)) {
    return true;
  }
  return false;
}

function updateHeadingStack(
  stack: Array<{ level: number; title: string }>,
  level: number,
  title: string
): Array<{ level: number; title: string }> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return stack;
  const trimmed = stack.filter((h) => h.level < level);
  trimmed.push({ level, title: cleanTitle });
  return trimmed;
}

function parsePlainOrMarkdownLines(params: {
  text: string;
  isMarkdown: boolean;
  pageNumber: number | null;
  initialStack?: Array<{ level: number; title: string }>;
}): {
  blocks: StructuredBlock[];
  stack: Array<{ level: number; title: string }>;
} {
  const blocks: StructuredBlock[] = [];
  let stack = params.initialStack ? [...params.initialStack] : [];
  const lines = params.text.replace(/\r\n/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      i++;
      continue;
    }

    // 1. Markdown ATX heading (# Heading)
    if (params.isMarkdown) {
      const mdHeading = line.match(/^(#{1,6})\s+(.+)$/);
      if (mdHeading) {
        const level = mdHeading[1].length;
        const title = mdHeading[2].replace(/\s+#+$/, '').trim();
        stack = updateHeadingStack(stack, level, title);
        blocks.push({
          type: 'heading',
          level,
          text: title,
          headingPath: stack.map((s) => s.title),
          sectionTitle: title,
          pageNumber: params.pageNumber,
          sheetName: null,
        });
        i++;
        continue;
      }

      // Markdown table block (| ... |)
      if (line.startsWith('|') && line.includes('|', 1)) {
        const tableLines: string[] = [];
        while (i < lines.length) {
          const tLine = lines[i].trim();
          if (!tLine.startsWith('|')) break;
          tableLines.push(tLine);
          i++;
        }
        if (tableLines.length > 0) {
          blocks.push({
            type: 'table',
            text: tableLines.join('\n'),
            headingPath: stack.map((s) => s.title),
            sectionTitle: stack.at(-1)?.title ?? null,
            pageNumber: params.pageNumber,
            sheetName: null,
          });
          continue;
        }
      }
    }

    // 2. Heuristic heading line (non-Markdown or PDF/TXT)
    if (isLikelyHeadingLine(line)) {
      const level = /^(فصل|بخش)/u.test(line) ? 1 : 2;
      stack = updateHeadingStack(stack, level, line);
      blocks.push({
        type: 'heading',
        level,
        text: line,
        headingPath: stack.map((s) => s.title),
        sectionTitle: line,
        pageNumber: params.pageNumber,
        sheetName: null,
      });
      i++;
      continue;
    }

    // 3. Bullet or numbered list block
    if (/^(?:[-*•▪]|[۰-۹\d]+[.)])\s+/.test(line)) {
      const listLines: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (!l) break;
        if (!/^(?:[-*•▪]|[۰-۹\d]+[.)])\s+/.test(l) && listLines.length > 0) {
          break;
        }
        listLines.push(l);
        i++;
      }
      blocks.push({
        type: 'list',
        text: listLines.join('\n'),
        headingPath: stack.map((s) => s.title),
        sectionTitle: stack.at(-1)?.title ?? null,
        pageNumber: params.pageNumber,
        sheetName: null,
      });
      continue;
    }

    // 4. Paragraph block until blank line / structural boundary
    const paraLines: string[] = [];
    while (i < lines.length) {
      const pLine = lines[i].trim();
      if (!pLine) break;
      if (params.isMarkdown && (/^#{1,6}\s+/.test(pLine) || pLine.startsWith('|'))) {
        break;
      }
      if (
        paraLines.length > 0 &&
        (isLikelyHeadingLine(pLine) || /^(?:[-*•▪]|[۰-۹\d]+[.)])\s+/.test(pLine))
      ) {
        break;
      }
      paraLines.push(pLine);
      i++;
    }

    if (paraLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        text: paraLines.join(' '),
        headingPath: stack.map((s) => s.title),
        sectionTitle: stack.at(-1)?.title ?? null,
        pageNumber: params.pageNumber,
        sheetName: null,
      });
    }
  }

  return { blocks, stack };
}

function parseDocxHtmlToBlocks(html: string): StructuredBlock[] {
  const blocks: StructuredBlock[] = [];
  let stack: Array<{ level: number; title: string }> = [];

  // Match top-level semantic elements produced by mammoth
  const tokenRegex =
    /<(h[1-6]|p|table|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[2];

    if (tag.startsWith('h')) {
      const level = Number(tag.slice(1)) || 1;
      const title = stripHtmlTags(inner);
      if (!title) continue;
      stack = updateHeadingStack(stack, level, title);
      blocks.push({
        type: 'heading',
        level,
        text: title,
        headingPath: stack.map((s) => s.title),
        sectionTitle: title,
        pageNumber: null,
        sheetName: null,
      });
      continue;
    }

    if (tag === 'table') {
      const rows: string[][] = [];
      const rowMatches = inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
      for (const rm of rowMatches) {
        const cells: string[] = [];
        const cellMatches = rm[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi);
        for (const cm of cellMatches) {
          cells.push(stripHtmlTags(cm[1]).replace(/\|/g, '/'));
        }
        if (cells.some((c) => c.length > 0)) {
          rows.push(cells);
        }
      }
      if (rows.length > 0) {
        const colCount = Math.max(...rows.map((r) => r.length));
        const normalizedRows = rows.map((r) => {
          const padded = [...r];
          while (padded.length < colCount) padded.push('');
          return `| ${padded.join(' | ')} |`;
        });
        const separator = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;
        const tableMd =
          normalizedRows.length > 1
            ? [normalizedRows[0], separator, ...normalizedRows.slice(1)].join('\n')
            : normalizedRows[0];

        blocks.push({
          type: 'table',
          text: tableMd,
          headingPath: stack.map((s) => s.title),
          sectionTitle: stack.at(-1)?.title ?? null,
          pageNumber: null,
          sheetName: null,
        });
      }
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const items: string[] = [];
      const liMatches = inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi);
      let idx = 1;
      for (const lm of liMatches) {
        const itemText = stripHtmlTags(lm[1]);
        if (itemText) {
          items.push(tag === 'ol' ? `${idx}. ${itemText}` : `- ${itemText}`);
          idx++;
        }
      }
      if (items.length > 0) {
        blocks.push({
          type: 'list',
          text: items.join('\n'),
          headingPath: stack.map((s) => s.title),
          sectionTitle: stack.at(-1)?.title ?? null,
          pageNumber: null,
          sheetName: null,
        });
      }
      continue;
    }

    // <p>
    const text = stripHtmlTags(inner);
    if (text) {
      if (isLikelyHeadingLine(text)) {
        stack = updateHeadingStack(stack, 2, text);
        blocks.push({
          type: 'heading',
          level: 2,
          text,
          headingPath: stack.map((s) => s.title),
          sectionTitle: text,
          pageNumber: null,
          sheetName: null,
        });
      } else {
        blocks.push({
          type: 'paragraph',
          text,
          headingPath: stack.map((s) => s.title),
          sectionTitle: stack.at(-1)?.title ?? null,
          pageNumber: null,
          sheetName: null,
        });
      }
    }
  }

  return blocks;
}

function cellValueToString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'object') {
    if ('result' in val && val.result !== undefined) {
      return cellValueToString(val.result as ExcelJS.CellValue);
    }
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((r) => r.text || '').join('').trim();
    }
    if ('text' in val && typeof val.text === 'string') {
      return val.text.trim();
    }
  }
  return String(val).trim();
}

async function extractXlsxStructured(
  buffer: Buffer
): Promise<{ blocks: StructuredBlock[]; extractedText: string; sheetNames: string[] }> {
  const workbook = new ExcelJS.Workbook();
  try {
    // Load via Uint8Array/ArrayBuffer cleanly for ExcelJS type compatibility
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
  } catch {
    throw new Error('INVALID_FILE_SIGNATURE');
  }

  const blocks: StructuredBlock[] = [];
  const sheetNames: string[] = [];
  const textParts: string[] = [];

  for (const worksheet of workbook.worksheets) {
    const sheetTitle = worksheet.name.trim() || `Sheet ${worksheet.id}`;
    const rawRows: string[][] = [];

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const rowCells = values.map((v) =>
        cellValueToString(v as ExcelJS.CellValue).replace(/\|/g, '/').replace(/\s+/g, ' ')
      );
      while (rowCells.length > 0 && rowCells[rowCells.length - 1] === '') {
        rowCells.pop();
      }
      if (rowCells.some((c) => c.length > 0)) {
        rawRows.push(rowCells);
      }
    });

    if (rawRows.length === 0) continue;
    sheetNames.push(sheetTitle);

    blocks.push({
      type: 'heading',
      level: 1,
      text: sheetTitle,
      headingPath: [sheetTitle],
      sectionTitle: sheetTitle,
      pageNumber: null,
      sheetName: sheetTitle,
    });

    const colCount = Math.max(...rawRows.map((r) => r.length));
    const paddedRows = rawRows.map((r) => {
      const next = [...r];
      while (next.length < colCount) next.push('');
      return next;
    });

    const headerRow = paddedRows[0];
    const headerLine = `| ${headerRow.join(' | ')} |`;
    const sepLine = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;
    const dataRows = paddedRows.slice(1);

    if (dataRows.length === 0) {
      blocks.push({
        type: 'table',
        text: headerLine,
        headingPath: [sheetTitle],
        sectionTitle: sheetTitle,
        pageNumber: null,
        sheetName: sheetTitle,
      });
      textParts.push(`## ${sheetTitle}\n${headerLine}`);
    } else {
      // Group rows into manageable table blocks (20 rows each) repeating header row so chunks retain column meanings
      const rowsPerTableBlock = 20;
      const sheetTableLines: string[] = [headerLine, sepLine];
      for (let start = 0; start < dataRows.length; start += rowsPerTableBlock) {
        const slice = dataRows.slice(start, start + rowsPerTableBlock);
        const bodyLines = slice.map((r) => `| ${r.join(' | ')} |`);
        const mdTable = [headerLine, sepLine, ...bodyLines].join('\n');
        blocks.push({
          type: 'table',
          text: mdTable,
          headingPath: [sheetTitle],
          sectionTitle: sheetTitle,
          pageNumber: null,
          sheetName: sheetTitle,
        });
        sheetTableLines.push(...bodyLines);
      }
      textParts.push(`## ${sheetTitle}\n${sheetTableLines.join('\n')}`);
    }
  }

  return {
    blocks,
    extractedText: textParts.join('\n\n').trim(),
    sheetNames,
  };
}

export async function validateAndExtractStructuredDocument(params: {
  filename: string;
  buffer: Buffer;
  maxBytes: number;
}): Promise<ExtractedStructuredDocument> {
  if (!params.buffer || params.buffer.length === 0) {
    throw new Error('EMPTY_FILE');
  }
  if (params.buffer.length > params.maxBytes) {
    throw new Error('FILE_TOO_LARGE');
  }

  const ext = getAllowedDocumentFormat(params.filename);
  if (!ext) {
    throw new Error('UNSUPPORTED_FILE_TYPE');
  }

  const sha256 = createHash('sha256').update(params.buffer).digest('hex');

  if (ext === 'pdf') {
    if (!hasPdfMagic(params.buffer)) {
      throw new Error('INVALID_FILE_SIGNATURE');
    }
    const result = await extractText(new Uint8Array(params.buffer), {
      mergePages: false,
    });
    const pageTexts = Array.isArray(result.text)
      ? result.text
      : [String(result.text || '')];

    const blocks: StructuredBlock[] = [];
    let stack: Array<{ level: number; title: string }> = [];
    const nonEmptyPages: string[] = [];

    for (let idx = 0; idx < pageTexts.length; idx++) {
      const pageNum = idx + 1;
      const pageRaw = normalizePersianPreservingStructure(pageTexts[idx] || '');
      if (!pageRaw) continue;
      nonEmptyPages.push(pageRaw);
      const parsed = parsePlainOrMarkdownLines({
        text: pageRaw,
        isMarkdown: false,
        pageNumber: pageNum,
        initialStack: stack,
      });
      stack = parsed.stack;
      blocks.push(...parsed.blocks);
    }

    const extractedText = nonEmptyPages.join('\n\n').trim();
    if (!extractedText) {
      throw new Error('EXTRACTED_TEXT_EMPTY');
    }

    return {
      extension: 'pdf',
      detectedMimeType: 'application/pdf',
      sha256,
      extractedText,
      blocks,
      pageCount: pageTexts.length,
      sheetNames: [],
    };
  }

  if (ext === 'docx') {
    if (!hasZipMagic(params.buffer)) {
      throw new Error('INVALID_FILE_SIGNATURE');
    }
    const [htmlResult, rawResult] = await Promise.all([
      mammoth.convertToHtml({ buffer: params.buffer }),
      mammoth.extractRawText({ buffer: params.buffer }),
    ]);

    const rawText = normalizePersianPreservingStructure(rawResult.value || '');
    const blocks = parseDocxHtmlToBlocks(htmlResult.value || '');

    // Fallback to plain line parser if HTML produced no structured blocks
    const finalBlocks =
      blocks.length > 0
        ? blocks
        : parsePlainOrMarkdownLines({
            text: rawText,
            isMarkdown: false,
            pageNumber: null,
          }).blocks;

    const extractedText =
      finalBlocks.length > 0
        ? finalBlocks.map((b) => b.text).join('\n\n').trim()
        : rawText;

    if (!extractedText) {
      throw new Error('EXTRACTED_TEXT_EMPTY');
    }

    return {
      extension: 'docx',
      detectedMimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sha256,
      extractedText,
      blocks: finalBlocks,
      pageCount: null,
      sheetNames: [],
    };
  }

  if (ext === 'xlsx') {
    if (!hasZipMagic(params.buffer)) {
      throw new Error('INVALID_FILE_SIGNATURE');
    }
    const xlsxResult = await extractXlsxStructured(params.buffer);
    if (!xlsxResult.extractedText) {
      throw new Error('EXTRACTED_TEXT_EMPTY');
    }
    return {
      extension: 'xlsx',
      detectedMimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sha256,
      extractedText: normalizePersianPreservingStructure(xlsxResult.extractedText),
      blocks: xlsxResult.blocks,
      pageCount: null,
      sheetNames: xlsxResult.sheetNames,
    };
  }

  // TXT / MD
  if (!isLikelyUtf8Text(params.buffer)) {
    throw new Error('INVALID_FILE_SIGNATURE');
  }

  const text = normalizePersianPreservingStructure(
    params.buffer.toString('utf8').replace(/^\uFEFF/, '')
  );
  if (!text) {
    throw new Error('EXTRACTED_TEXT_EMPTY');
  }

  const { blocks } = parsePlainOrMarkdownLines({
    text,
    isMarkdown: ext === 'md',
    pageNumber: null,
  });

  return {
    extension: ext,
    detectedMimeType: ext === 'md' ? 'text/markdown' : 'text/plain',
    sha256,
    extractedText: text,
    blocks,
    pageCount: null,
    sheetNames: [],
  };
}
