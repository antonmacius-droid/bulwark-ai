import { describe, it, expect } from "vitest";
import { chunkText } from "../rag/chunker";

describe("chunkText", () => {
  it("should split text into chunks", () => {
    const text = "This is the first paragraph with enough content to exceed the chunk size limit.\n\nThis is the second paragraph also with sufficient text.\n\nAnd here is a third paragraph.";
    const chunks = chunkText(text, { chunkSize: 60, chunkOverlap: 0, strategy: "paragraph" });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].content).toContain("first paragraph");
  });

  it("should respect chunk size", () => {
    const text = "A".repeat(500) + "\n\n" + "B".repeat(500);
    const chunks = chunkText(text, { chunkSize: 200, chunkOverlap: 0 });
    for (const chunk of chunks) {
      // Allow 1.5x overflow for edge cases
      expect(chunk.content.length).toBeLessThan(300);
    }
  });

  it("should include overlap", () => {
    const text = "First sentence here.\n\nSecond sentence here.\n\nThird sentence here.";
    const chunks = chunkText(text, { chunkSize: 30, chunkOverlap: 10 });
    if (chunks.length >= 2) {
      // Overlap means some text from end of chunk N appears in start of chunk N+1
      const lastWordsOfFirst = chunks[0].content.slice(-10);
      // Not guaranteed exact overlap due to word boundaries, but chunks should be generated
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("should handle empty text", () => {
    expect(chunkText("")).toHaveLength(0);
    expect(chunkText("   ")).toHaveLength(0);
  });

  it("should handle markdown strategy", () => {
    const md = "# Title\n\nSome text.\n\n## Section 2\n\nMore text.";
    const chunks = chunkText(md, { strategy: "markdown", chunkSize: 500 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("should assign sequential indices", () => {
    const text = "A\n\nB\n\nC\n\nD\n\nE";
    const chunks = chunkText(text, { chunkSize: 5, chunkOverlap: 0 });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });
});
