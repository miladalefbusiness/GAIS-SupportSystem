import { randomUUID } from 'node:crypto';
import { buildLexicalIndexString } from '../normalizer.ts';
import type {
  ChunkDraft,
  DocumentClassification,
  StructuredBlock,
} from '../types.ts';

export interface ParentChildChunkingOptions {
  parentMaxChars?: number;
  childMaxChars?: number;
  childOverlapChars?: number;
}

interface SectionGroup {
  headingPath: string | null;
  sectionTitle: string | null;
  pageNumber: number | null;
  sheetName: string | null;
  blocks: StructuredBlock[];
}

function splitMarkdownTableBlock(
  tableText: string,
  maxChars: number
): string[] {
  const lines = tableText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length <= 2 || tableText.length <= maxChars) {
    return [tableText];
  }

  const hasSeparator =
    lines.length >= 2 && /^\|?\s*:?-{2,}:?\s*(\||$)/.test(lines[1]);
  const headerPrefix = hasSeparator ? [lines[0], lines[1]] : [lines[0]];
  const bodyLines = lines.slice(headerPrefix.length);

  const pieces: string[] = [];
  let current = [...headerPrefix];

  for (const rowLine of bodyLines) {
    const candidate = [...current, rowLine].join('\n');
    if (candidate.length > maxChars && current.length > headerPrefix.length) {
      pieces.push(current.join('\n'));
      current = [...headerPrefix, rowLine];
    } else {
      current.push(rowLine);
    }
  }

  if (current.length > headerPrefix.length) {
    pieces.push(current.join('\n'));
  }

  return pieces.length > 0 ? pieces : [tableText];
}

function splitLongTextBySentenceOrWord(
  text: string,
  maxChars: number,
  overlapChars: number
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const results: string[] = [];
  let cursor = 0;

  while (cursor < trimmed.length) {
    let end = Math.min(cursor + maxChars, trimmed.length);
    if (end < trimmed.length) {
      const segment = trimmed.slice(cursor, end);
      // Prefer breaking on sentence/newline boundary, fallback to space
      const sentenceCut = Math.max(
        segment.lastIndexOf('\n'),
        segment.lastIndexOf('. '),
        segment.lastIndexOf('.\n'),
        segment.lastIndexOf('؟ '),
        segment.lastIndexOf('؛ ')
      );
      if (sentenceCut > Math.floor(maxChars * 0.45)) {
        end = cursor + sentenceCut + 1;
      } else {
        const lastSpace = trimmed.lastIndexOf(' ', end);
        if (lastSpace > cursor + Math.floor(maxChars * 0.45)) {
          end = lastSpace;
        }
      }
    }

    const slice = trimmed.slice(cursor, end).trim();
    if (slice) results.push(slice);
    if (end >= trimmed.length) break;
    cursor = Math.max(cursor + 1, end - overlapChars);
  }

  return results;
}

function groupBlocksIntoSections(
  blocks: StructuredBlock[],
  parentMaxChars: number
): SectionGroup[] {
  const sections: SectionGroup[] = [];
  let current: SectionGroup | null = null;
  let currentLen = 0;

  for (const block of blocks) {
    const headingPathStr =
      block.headingPath.length > 0 ? block.headingPath.join(' > ') : null;

    const shouldStartNewSection =
      !current ||
      block.type === 'heading' ||
      block.sheetName !== current.sheetName ||
      headingPathStr !== current.headingPath ||
      (currentLen + block.text.length > parentMaxChars &&
        current.blocks.some((b) => b.type !== 'heading'));

    if (shouldStartNewSection) {
      if (current && current.blocks.length > 0) {
        sections.push(current);
      }
      current = {
        headingPath: headingPathStr,
        sectionTitle: block.sectionTitle,
        pageNumber: block.pageNumber,
        sheetName: block.sheetName,
        blocks: [block],
      };
      currentLen = block.text.length;
    } else if (current) {
      current.blocks.push(block);
      currentLen += block.text.length + 2;
      if (current.pageNumber === null && block.pageNumber !== null) {
        current.pageNumber = block.pageNumber;
      }
    }
  }

  if (current && current.blocks.length > 0) {
    sections.push(current);
  }

  return sections;
}

/**
 * Generates parent section chunks (`chunkLevel: 'parent'`) and precise child retrieval chunks
 * (`chunkLevel: 'child'`) with complete document/page/section/classification provenance.
 */
export function buildParentChildChunks(params: {
  documentId: string;
  documentVersion: number;
  titleFa: string;
  collectionId: string | null;
  departmentIds: string[];
  classification: DocumentClassification;
  blocks: StructuredBlock[];
  fallbackText?: string;
  options?: ParentChildChunkingOptions;
}): ChunkDraft[] {
  const parentMaxChars = params.options?.parentMaxChars ?? 2200;
  const childMaxChars = params.options?.childMaxChars ?? 820;
  const childOverlapChars = params.options?.childOverlapChars ?? 120;
  const indexedAt = new Date().toISOString();

  const effectiveBlocks: StructuredBlock[] =
    params.blocks.length > 0
      ? params.blocks
      : (params.fallbackText || '')
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => ({
            type: 'paragraph',
            text: p,
            headingPath: [],
            sectionTitle: null,
            pageNumber: null,
            sheetName: null,
          }));

  if (effectiveBlocks.length === 0) return [];

  const sectionGroups = groupBlocksIntoSections(effectiveBlocks, parentMaxChars);
  const allChunks: ChunkDraft[] = [];
  let seqIndex = 0;

  for (const sec of sectionGroups) {
    const parentId = `kbc_${randomUUID()}`;
    const parentText = sec.blocks
      .map((b) => (b.type === 'heading' ? `## ${b.text}` : b.text))
      .join('\n\n')
      .trim();

    if (!parentText) continue;

    const contextHeaderParts = [
      params.titleFa,
      sec.headingPath || undefined,
      sec.sheetName ? `برگه ${sec.sheetName}` : undefined,
      sec.pageNumber ? `صفحه ${sec.pageNumber}` : undefined,
    ].filter((x): x is string => Boolean(x));

    const parentSeq = seqIndex++;
    const parentRef = `${params.documentId}#v${params.documentVersion}:p${sec.pageNumber ?? 0}:s${parentSeq}`;

    allChunks.push({
      id: parentId,
      parentChunkId: null,
      chunkLevel: 'parent',
      chunkIndex: parentSeq,
      chunkType: 'section',
      content: parentText,
      normalizedContent: buildLexicalIndexString(parentText, contextHeaderParts),
      tokenEstimate: Math.ceil(parentText.length / 4),
      headingPath: sec.headingPath,
      sectionTitle: sec.sectionTitle,
      pageNumber: sec.pageNumber,
      sheetName: sec.sheetName,
      sourceRef: parentRef,
      classification: params.classification,
      provenance: {
        documentId: params.documentId,
        documentVersion: params.documentVersion,
        collectionId: params.collectionId,
        departmentIds: params.departmentIds,
        pageNumber: sec.pageNumber,
        sheetName: sec.sheetName,
        sectionTitle: sec.sectionTitle,
        headingPath: sec.headingPath,
        chunkSequence: parentSeq,
        sourceRef: parentRef,
        classification: params.classification,
        chunkLevel: 'parent',
        chunkType: 'section',
        indexedAt,
      },
    });

    // Build child units while preserving block boundaries (tables stay intact with headers!)
    const childBlocks = sec.blocks.filter((b) => b.type !== 'heading');
    const unitsToChunk =
      childBlocks.length > 0
        ? childBlocks
        : sec.blocks; // If section only had a heading line, index it as a child too

    const rawChildEntries: Array<{
      text: string;
      chunkType: 'text' | 'table' | 'list';
      pageNumber: number | null;
      sheetName: string | null;
    }> = [];

    let pendingProse = '';
    let pendingPage: number | null = sec.pageNumber;
    let pendingSheet: string | null = sec.sheetName;
    let pendingType: 'text' | 'list' = 'text';

    const flushPendingProse = () => {
      const clean = pendingProse.trim();
      if (!clean) return;
      const pieces = splitLongTextBySentenceOrWord(
        clean,
        childMaxChars,
        childOverlapChars
      );
      for (const piece of pieces) {
        rawChildEntries.push({
          text: piece,
          chunkType: pendingType,
          pageNumber: pendingPage,
          sheetName: pendingSheet,
        });
      }
      pendingProse = '';
      pendingType = 'text';
    };

    for (const blk of unitsToChunk) {
      if (blk.type === 'table') {
        flushPendingProse();
        const tablePieces = splitMarkdownTableBlock(blk.text, childMaxChars);
        for (const tp of tablePieces) {
          rawChildEntries.push({
            text: tp,
            chunkType: 'table',
            pageNumber: blk.pageNumber ?? sec.pageNumber,
            sheetName: blk.sheetName ?? sec.sheetName,
          });
        }
        continue;
      }

      const candidate = pendingProse
        ? `${pendingProse}\n\n${blk.text}`
        : blk.text;
      if (candidate.length <= childMaxChars) {
        pendingProse = candidate;
        if (blk.type === 'list') pendingType = 'list';
        if (blk.pageNumber !== null) pendingPage = blk.pageNumber;
        if (blk.sheetName !== null) pendingSheet = blk.sheetName;
      } else {
        const previousTail =
          pendingProse.length > childOverlapChars
            ? pendingProse.slice(pendingProse.length - childOverlapChars).trim()
            : '';
        flushPendingProse();
        if (blk.text.length > childMaxChars) {
          const pieces = splitLongTextBySentenceOrWord(
            blk.text,
            childMaxChars,
            childOverlapChars
          );
          for (const piece of pieces) {
            rawChildEntries.push({
              text: piece,
              chunkType: blk.type === 'list' ? 'list' : 'text',
              pageNumber: blk.pageNumber ?? sec.pageNumber,
              sheetName: blk.sheetName ?? sec.sheetName,
            });
          }
        } else {
          pendingProse = previousTail ? `${previousTail}\n\n${blk.text}` : blk.text;
          pendingType = blk.type === 'list' ? 'list' : 'text';
          pendingPage = blk.pageNumber ?? sec.pageNumber;
          pendingSheet = blk.sheetName ?? sec.sheetName;
        }
      }
    }

    flushPendingProse();

    const headingPrefix = sec.headingPath ? `[${sec.headingPath}]\n` : '';
    for (const entry of rawChildEntries) {
      const childSeq = seqIndex++;
      const childId = `kbc_${randomUUID()}`;
      const childContent =
        headingPrefix && !entry.text.startsWith(headingPrefix)
          ? `${headingPrefix}${entry.text}`
          : entry.text;
      const childRef = `${params.documentId}#v${params.documentVersion}:p${entry.pageNumber ?? 0}:c${childSeq}`;

      allChunks.push({
        id: childId,
        parentChunkId: parentId,
        chunkLevel: 'child',
        chunkIndex: childSeq,
        chunkType: entry.chunkType,
        content: childContent,
        normalizedContent: buildLexicalIndexString(childContent, [
          params.titleFa,
          sec.headingPath || '',
          entry.sheetName || '',
        ]),
        tokenEstimate: Math.ceil(childContent.length / 4),
        headingPath: sec.headingPath,
        sectionTitle: sec.sectionTitle,
        pageNumber: entry.pageNumber,
        sheetName: entry.sheetName,
        sourceRef: childRef,
        classification: params.classification,
        provenance: {
          documentId: params.documentId,
          documentVersion: params.documentVersion,
          collectionId: params.collectionId,
          departmentIds: params.departmentIds,
          pageNumber: entry.pageNumber,
          sheetName: entry.sheetName,
          sectionTitle: sec.sectionTitle,
          headingPath: sec.headingPath,
          chunkSequence: childSeq,
          sourceRef: childRef,
          classification: params.classification,
          chunkLevel: 'child',
          chunkType: entry.chunkType,
          indexedAt,
        },
      });
    }
  }

  return allChunks;
}
