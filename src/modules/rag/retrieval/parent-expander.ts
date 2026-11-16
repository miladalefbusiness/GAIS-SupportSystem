import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { knowledgeChunks } from '@/src/db/schema.ts';

export interface ChildChunkReference {
  chunkId: string;
  documentId: string;
  parentChunkId: string | null;
  chunkIndex: number;
  content: string;
}

export interface ExpandedParentContext {
  expandedContent: string;
  parentChunkId: string | null;
  headingPath: string | null;
  sectionTitle: string | null;
  pageNumber: number | null;
  sheetName: string | null;
  expandedFromParent: boolean;
}

/**
 * Expands matched child chunks with their parent section chunks (or adjacent siblings
 * when a legacy chunk has no parent), preserving full regulatory/table context.
 */
export async function resolveParentChildContextMap(
  children: ChildChunkReference[],
  options?: { maxContextChars?: number }
): Promise<Map<string, ExpandedParentContext>> {
  const resultMap = new Map<string, ExpandedParentContext>();
  if (children.length === 0) return resultMap;

  const maxContextChars = options?.maxContextChars ?? 2400;

  const parentIds = Array.from(
    new Set(
      children
        .map((c) => c.parentChunkId)
        .filter((id): id is string => Boolean(id))
    )
  );

  const parentRows =
    parentIds.length > 0
      ? await db
          .select({
            id: knowledgeChunks.id,
            content: knowledgeChunks.content,
            headingPath: knowledgeChunks.headingPath,
            sectionTitle: knowledgeChunks.sectionTitle,
            pageNumber: knowledgeChunks.pageNumber,
            sheetName: knowledgeChunks.sheetName,
            isActive: knowledgeChunks.isActive,
          })
          .from(knowledgeChunks)
          .where(
            and(
              inArray(knowledgeChunks.id, parentIds),
              eq(knowledgeChunks.isActive, true)
            )
          )
      : [];

  const parentById = new Map(parentRows.map((p) => [p.id, p]));

  // Sibling fallback for legacy chunks without parentChunkId
  const orphanChildren = children.filter(
    (c) => !c.parentChunkId || !parentById.has(c.parentChunkId)
  );
  const siblingMap = new Map<string, string[]>();

  if (orphanChildren.length > 0) {
    const docIds = Array.from(new Set(orphanChildren.map((c) => c.documentId)));
    const neighborRows = await db
      .select({
        documentId: knowledgeChunks.documentId,
        chunkIndex: knowledgeChunks.chunkIndex,
        content: knowledgeChunks.content,
      })
      .from(knowledgeChunks)
      .where(
        and(
          inArray(knowledgeChunks.documentId, docIds),
          eq(knowledgeChunks.isActive, true),
          or(
            eq(knowledgeChunks.chunkLevel, 'child'),
            eq(knowledgeChunks.chunkLevel, 'parent')
          )
        )
      );

    for (const orphan of orphanChildren) {
      const neighbors = neighborRows
        .filter(
          (r) =>
            r.documentId === orphan.documentId &&
            Math.abs(r.chunkIndex - orphan.chunkIndex) <= 1
        )
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((r) => r.content);
      siblingMap.set(orphan.chunkId, neighbors);
    }
  }

  for (const child of children) {
    const parent = child.parentChunkId
      ? parentById.get(child.parentChunkId)
      : undefined;

    if (parent && parent.content.trim().length > child.content.trim().length) {
      const trimmedParent =
        parent.content.length > maxContextChars
          ? `${parent.content.slice(0, maxContextChars)}...`
          : parent.content;
      resultMap.set(child.chunkId, {
        expandedContent: trimmedParent,
        parentChunkId: parent.id,
        headingPath: parent.headingPath,
        sectionTitle: parent.sectionTitle,
        pageNumber: parent.pageNumber,
        sheetName: parent.sheetName,
        expandedFromParent: true,
      });
    } else {
      const sibs = siblingMap.get(child.chunkId);
      if (sibs && sibs.length > 1) {
        const merged = sibs.join('\n\n').slice(0, maxContextChars);
        resultMap.set(child.chunkId, {
          expandedContent: merged,
          parentChunkId: child.parentChunkId,
          headingPath: null,
          sectionTitle: null,
          pageNumber: null,
          sheetName: null,
          expandedFromParent: true,
        });
      } else {
        resultMap.set(child.chunkId, {
          expandedContent: child.content.slice(0, maxContextChars),
          parentChunkId: child.parentChunkId,
          headingPath: null,
          sectionTitle: null,
          pageNumber: null,
          sheetName: null,
          expandedFromParent: false,
        });
      }
    }
  }

  return resultMap;
}
