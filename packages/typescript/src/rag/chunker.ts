/**
 * Document chunking — splits text into overlapping chunks for embedding.
 * Supports: plain text, markdown, code.
 */

export interface ChunkOptions {
  /** Max characters per chunk */
  chunkSize?: number;
  /** Overlap between chunks */
  chunkOverlap?: number;
  /** Split strategy */
  strategy?: "paragraph" | "sentence" | "fixed" | "markdown";
}

export interface TextChunk {
  content: string;
  index: number;
  metadata?: Record<string, unknown>;
}

const PARAGRAPH_SEPARATORS = ["\n\n", "\r\n\r\n"];
const SENTENCE_ENDINGS = /(?<=[.!?])\s+/;
const MARKDOWN_HEADERS = /^#{1,6}\s/m;

export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const { chunkSize = 1000, chunkOverlap = 200, strategy = "paragraph" } = options;
  const chunks: TextChunk[] = [];

  if (!text || text.trim().length === 0) return [];

  let segments: string[];

  switch (strategy) {
    case "markdown":
      segments = splitByMarkdown(text);
      break;
    case "sentence":
      segments = text.split(SENTENCE_ENDINGS).filter(s => s.trim().length > 0);
      break;
    case "paragraph":
      segments = splitByParagraph(text);
      break;
    case "fixed":
    default:
      segments = splitFixed(text, chunkSize);
      break;
  }

  // Merge small segments and split large ones
  let currentChunk = "";
  let chunkIndex = 0;

  for (const segment of segments) {
    if (currentChunk.length + segment.length > chunkSize && currentChunk.length > 0) {
      chunks.push({ content: currentChunk.trim(), index: chunkIndex++ });

      // Keep overlap
      if (chunkOverlap > 0) {
        const overlapStart = Math.max(0, currentChunk.length - chunkOverlap);
        currentChunk = currentChunk.slice(overlapStart) + " " + segment;
      } else {
        currentChunk = segment;
      }
    } else {
      currentChunk += (currentChunk ? " " : "") + segment;
    }

    // If single segment exceeds chunk size, force split
    if (currentChunk.length > chunkSize * 1.5) {
      const forceSplit = splitFixed(currentChunk, chunkSize);
      for (let i = 0; i < forceSplit.length - 1; i++) {
        chunks.push({ content: forceSplit[i].trim(), index: chunkIndex++ });
      }
      currentChunk = forceSplit[forceSplit.length - 1];
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({ content: currentChunk.trim(), index: chunkIndex });
  }

  return chunks;
}

function splitByParagraph(text: string): string[] {
  for (const sep of PARAGRAPH_SEPARATORS) {
    if (text.includes(sep)) {
      return text.split(sep).filter(s => s.trim().length > 0);
    }
  }
  return text.split("\n").filter(s => s.trim().length > 0);
}

function splitByMarkdown(text: string): string[] {
  const sections: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if (MARKDOWN_HEADERS.test(line) && current.trim().length > 0) {
      sections.push(current.trim());
      current = line;
    } else {
      current += "\n" + line;
    }
  }
  if (current.trim().length > 0) sections.push(current.trim());

  return sections.length > 0 ? sections : splitByParagraph(text);
}

function splitFixed(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
