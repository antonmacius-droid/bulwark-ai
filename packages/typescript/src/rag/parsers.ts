/**
 * Document parsers for RAG ingestion.
 * Extracts text from PDF, DOCX, HTML, and plain text files.
 */

/**
 * Parse a PDF buffer into text.
 * Requires `pdf-parse` as a peer dependency.
 *
 * @example
 * ```ts
 * const text = await parsePDF(fs.readFileSync("contract.pdf"));
 * await kb.ingest(text, { name: "contract.pdf", type: "pdf" });
 * ```
 */
export async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text || "";
  } catch (err) {
    throw new Error(`PDF parsing failed. Install pdf-parse: npm install pdf-parse. Error: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Parse an HTML string into plain text.
 * Strips all tags, scripts, styles, and normalizes whitespace.
 */
export function parseHTML(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a CSV string into text (row per line).
 */
export function parseCSV(csv: string): string {
  const lines = csv.split("\n").filter(l => l.trim());
  if (lines.length === 0) return "";

  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    return headers.map((h, i) => `${h}: ${values[i] || ""}`).join(", ");
  });

  return rows.join("\n");
}

/**
 * Parse a Markdown file — strips formatting but preserves structure.
 */
export function parseMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")      // headers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1")     // italic
    .replace(/`([^`]+)`/g, "$1")       // inline code
    .replace(/```[\s\S]*?```/g, "")    // code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/^\s*[-*+]\s+/gm, "")    // list markers
    .replace(/^\s*\d+\.\s+/gm, "")    // numbered lists
    .replace(/\n{3,}/g, "\n\n")        // normalize newlines
    .trim();
}

/**
 * Auto-detect file type and parse to text.
 */
export async function parseDocument(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop();

  switch (ext) {
    case "pdf":
      return parsePDF(buffer);
    case "html":
    case "htm":
      return parseHTML(buffer.toString("utf-8"));
    case "csv":
      return parseCSV(buffer.toString("utf-8"));
    case "md":
    case "markdown":
      return parseMarkdown(buffer.toString("utf-8"));
    case "txt":
    case "text":
    case "log":
      return buffer.toString("utf-8");
    case "json":
      return JSON.stringify(JSON.parse(buffer.toString("utf-8")), null, 2);
    default:
      // Try as plain text
      return buffer.toString("utf-8");
  }
}
