import {
  getAllowedDocumentFormat,
  validateAndExtractStructuredDocument,
} from '../rag/chunking/structured-parser.ts';
import type {
  ExtractedStructuredDocument,
  StructuredBlock,
  SupportedDocumentFormat,
} from '../rag/types.ts';

export type SupportedKbExtension = SupportedDocumentFormat;

export interface ExtractedDocumentResult extends ExtractedStructuredDocument {
  blocks: StructuredBlock[];
}

export function getAllowedExtension(filename: string): SupportedKbExtension | null {
  return getAllowedDocumentFormat(filename);
}

export async function validateAndExtractDocument(params: {
  filename: string;
  buffer: Buffer;
  maxBytes: number;
}): Promise<ExtractedDocumentResult> {
  return validateAndExtractStructuredDocument(params);
}
