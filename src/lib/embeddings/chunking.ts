/**
 * Text chunking strategies for document embeddings
 * Phase 2: Document Management & RAG
 */

import {
  detectCalloutBoxes,
  extractCalloutMetadata,
  splitPreservingCallouts,
  type CalloutMetadata
} from '@/lib/metadata/callout-detector';

export interface TextChunk {
  content: string
  index: number
  startChar: number
  endChar: number
  metadata?: {
    pageNumber?: number
    section?: string
    chunkType?: 'callout_box' | 'note' | 'title_block' | 'legend' | 'detail' | 'text';
    containsComponents?: boolean;
    componentList?: string[];
    systemName?: string;
    station?: string;
  }
}

export interface ChunkingOptions {
  chunkSize: number // Target size in characters
  overlapSize: number // Overlap between chunks in characters
  preserveSentences: boolean // Try to break at sentence boundaries
  preserveParagraphs: boolean // Try to keep paragraphs together if possible
}

const DEFAULT_OPTIONS: ChunkingOptions = {
  chunkSize: 1000, // ~250 tokens for most text
  overlapSize: 200, // 20% overlap
  preserveSentences: true,
  preserveParagraphs: true,
}

/**
 * Split text into overlapping chunks for embedding
 */
export function chunkText(
  text: string,
  options: Partial<ChunkingOptions> = {}
): TextChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Normalize whitespace
  const normalizedText = text.replace(/\s+/g, ' ').trim()

  if (normalizedText.length === 0) {
    return []
  }

  const chunks: TextChunk[] = []
  let currentIndex = 0
  let chunkIndex = 0

  while (currentIndex < normalizedText.length) {
    let endIndex = currentIndex + opts.chunkSize

    // Don't go past the end
    if (endIndex >= normalizedText.length) {
      endIndex = normalizedText.length
    } else {
      // Try to break at sentence boundary
      if (opts.preserveSentences) {
        const sentenceEnd = findSentenceBoundary(
          normalizedText,
          endIndex,
          currentIndex
        )
        if (sentenceEnd > currentIndex) {
          endIndex = sentenceEnd
        }
      }

      // If no sentence boundary found, try paragraph boundary
      if (opts.preserveParagraphs && endIndex === currentIndex + opts.chunkSize) {
        const paragraphEnd = findParagraphBoundary(
          normalizedText,
          endIndex,
          currentIndex
        )
        if (paragraphEnd > currentIndex) {
          endIndex = paragraphEnd
        }
      }

      // Last resort: break at word boundary
      if (endIndex === currentIndex + opts.chunkSize) {
        const wordEnd = findWordBoundary(normalizedText, endIndex, currentIndex)
        if (wordEnd > currentIndex) {
          endIndex = wordEnd
        }
      }
    }

    // Extract chunk
    const chunkContent = normalizedText.slice(currentIndex, endIndex).trim()

    if (chunkContent.length > 0) {
      chunks.push({
        content: chunkContent,
        index: chunkIndex,
        startChar: currentIndex,
        endChar: endIndex,
      })
      chunkIndex++
    }

    // Move to next chunk with overlap
    if (endIndex >= normalizedText.length) {
      break
    }

    currentIndex = endIndex - opts.overlapSize
    if (currentIndex < 0) currentIndex = 0
  }

  return chunks
}

/**
 * Find the nearest sentence boundary (period, question mark, exclamation)
 */
function findSentenceBoundary(
  text: string,
  targetIndex: number,
  minIndex: number
): number {
  const sentenceEnders = ['. ', '? ', '! ', '.\n', '?\n', '!\n']

  // Search backward from target
  let bestIndex = -1
  let searchStart = Math.max(minIndex, targetIndex - 200) // Don't search too far back

  for (const ender of sentenceEnders) {
    const index = text.lastIndexOf(ender, targetIndex)
    if (index >= searchStart && index > bestIndex) {
      bestIndex = index + ender.length
    }
  }

  // If found a boundary close enough, use it
  if (bestIndex > minIndex && bestIndex <= targetIndex) {
    return bestIndex
  }

  // Search forward a bit if backward search failed
  searchStart = targetIndex
  const searchEnd = Math.min(text.length, targetIndex + 100)

  for (const ender of sentenceEnders) {
    const index = text.indexOf(ender, searchStart)
    if (index >= searchStart && index < searchEnd) {
      return index + ender.length
    }
  }

  return targetIndex
}

/**
 * Find the nearest paragraph boundary (double newline or similar)
 */
function findParagraphBoundary(
  text: string,
  targetIndex: number,
  minIndex: number
): number {
  const paragraphBreaks = ['\n\n', '\n \n', '\r\n\r\n']

  let bestIndex = -1
  const searchStart = Math.max(minIndex, targetIndex - 100)

  for (const breaker of paragraphBreaks) {
    const index = text.lastIndexOf(breaker, targetIndex)
    if (index >= searchStart && index > bestIndex) {
      bestIndex = index + breaker.length
    }
  }

  if (bestIndex > minIndex && bestIndex <= targetIndex) {
    return bestIndex
  }

  return targetIndex
}

/**
 * Find the nearest word boundary (space)
 */
function findWordBoundary(
  text: string,
  targetIndex: number,
  minIndex: number
): number {
  // Search backward for space
  let index = targetIndex
  while (index > minIndex) {
    if (text[index] === ' ' || text[index] === '\n') {
      return index + 1
    }
    index--
  }

  return targetIndex
}

/**
 * Chunk text with page number tracking
 * Useful for documents where page breaks are marked
 */
export function chunkTextWithPages(
  text: string,
  pageBreakMarker: string = '\n---PAGE-BREAK---\n',
  options: Partial<ChunkingOptions> = {}
): TextChunk[] {
  const pages = text.split(pageBreakMarker)
  const allChunks: TextChunk[] = []

  let globalCharOffset = 0

  pages.forEach((pageText, pageIndex) => {
    const pageChunks = chunkText(pageText, options)

    // Add page number metadata and adjust char positions
    pageChunks.forEach((chunk) => {
      allChunks.push({
        ...chunk,
        index: allChunks.length,
        startChar: chunk.startChar + globalCharOffset,
        endChar: chunk.endChar + globalCharOffset,
        metadata: {
          pageNumber: pageIndex + 1,
        },
      })
    })

    globalCharOffset += pageText.length + pageBreakMarker.length
  })

  return allChunks
}

/**
 * Get estimated token count for a chunk
 * Rough approximation: 1 token ≈ 4 characters for English text
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Validate chunk quality (not too short, not empty)
 */
export function isValidChunk(chunk: TextChunk, minLength: number = 50): boolean {
  return chunk.content.trim().length >= minLength
}

/**
 * Smart chunking that preserves callout boxes as complete semantic units
 *
 * This is the RECOMMENDED chunking method for construction plans.
 *
 * Callout boxes contain critical component lists and should never be split.
 * This function:
 * 1. Detects callout boxes in the text
 * 2. Preserves them as complete chunks (no splitting)
 * 3. Chunks the surrounding text normally
 * 4. Adds callout metadata to chunks
 *
 * @param text - Source text
 * @param options - Chunking options
 * @returns Array of chunks with callout boxes preserved
 */
export function chunkTextPreservingCallouts(
  text: string,
  options: Partial<ChunkingOptions> = {}
): TextChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // First, split text preserving callout boxes
  const segments = splitPreservingCallouts(text, opts.chunkSize);

  const chunks: TextChunk[] = [];
  let globalCharOffset = 0;

  for (const segment of segments) {
    if (segment.hasCallout) {
      // Callout box - keep as single chunk with metadata
      chunks.push({
        content: segment.text.trim(),
        index: chunks.length,
        startChar: globalCharOffset,
        endChar: globalCharOffset + segment.text.length,
        metadata: {
          chunkType: 'callout_box',
          containsComponents: segment.metadata?.containsComponents || false,
          componentList: segment.metadata?.componentList,
          systemName: segment.metadata?.systemName,
          station: segment.metadata?.station
        }
      });
    } else {
      // Regular text - chunk normally
      const regularChunks = chunkText(segment.text, opts);

      // Add regular chunks with adjusted positions
      for (const chunk of regularChunks) {
        chunks.push({
          ...chunk,
          index: chunks.length,
          startChar: chunk.startChar + globalCharOffset,
          endChar: chunk.endChar + globalCharOffset,
          metadata: {
            ...chunk.metadata,
            chunkType: 'text'
          }
        });
      }
    }

    globalCharOffset += segment.text.length;
  }

  return chunks;
}

/**
 * Chunk text with page tracking AND callout preservation
 *
 * Combines page-aware chunking with callout box preservation.
 * This is the BEST method for construction plan PDFs.
 *
 * @param text - Source text
 * @param pageBreakMarker - Marker for page breaks
 * @param options - Chunking options
 * @returns Array of chunks with page numbers and callout metadata
 */
export function chunkTextWithPagesAndCallouts(
  text: string,
  pageBreakMarker: string = '\n---PAGE-BREAK---\n',
  options: Partial<ChunkingOptions> = {}
): TextChunk[] {
  const pages = text.split(pageBreakMarker);
  const allChunks: TextChunk[] = [];

  let globalCharOffset = 0;

  pages.forEach((pageText, pageIndex) => {
    // Use callout-preserving chunking for each page
    const pageChunks = chunkTextPreservingCallouts(pageText, options);

    // Add page number metadata and adjust char positions
    pageChunks.forEach((chunk) => {
      allChunks.push({
        ...chunk,
        index: allChunks.length,
        startChar: chunk.startChar + globalCharOffset,
        endChar: chunk.endChar + globalCharOffset,
        metadata: {
          ...chunk.metadata,
          pageNumber: pageIndex + 1,
        },
      });
    });

    globalCharOffset += pageText.length + pageBreakMarker.length;
  });

  return allChunks;
}

/**
 * Detect chunk type from content
 *
 * Useful for classifying chunks during processing
 */
export function detectChunkType(content: string): 'callout_box' | 'title_block' | 'legend' | 'note' | 'detail' | 'text' {
  const normalized = content.toLowerCase();

  // Callout box patterns
  if (extractCalloutMetadata(content).isCalloutBox) {
    return 'callout_box';
  }

  // Title block patterns
  if (normalized.includes('sheet') && normalized.includes('date')) {
    return 'title_block';
  }

  // Legend patterns
  if (normalized.includes('legend') || normalized.includes('symbol')) {
    return 'legend';
  }

  // Detail patterns
  if (normalized.match(/detail\s+[\w\d-]+/i) || normalized.includes('typical')) {
    return 'detail';
  }

  // Note patterns
  if (normalized.startsWith('note') || normalized.includes('general note')) {
    return 'note';
  }

  return 'text';
}
