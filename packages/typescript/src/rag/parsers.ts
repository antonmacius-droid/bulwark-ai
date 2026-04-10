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
  // Remove script/style blocks by finding start/end tags iteratively (avoids ReDoS)
  let text = html;
  for (const tag of ["script", "style"]) {
    let result = "";
    let remaining = text;
    const openRe = new RegExp(`<${tag}[\\s>]`, "i");
    const closeTag = `</${tag}>`;
    let match: RegExpExecArray | null;
    while ((match = openRe.exec(remaining)) !== null) {
      result += remaining.slice(0, match.index);
      const closeIdx = remaining.toLowerCase().indexOf(closeTag.toLowerCase(), match.index);
      if (closeIdx === -1) { remaining = ""; break; }
      remaining = remaining.slice(closeIdx + closeTag.length);
    }
    result += remaining;
    text = result;
  }
  return text
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
 * Split a CSV line respecting quoted fields (handles commas inside quotes).
 */
function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'; // escaped quote
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse a CSV string into text (row per line).
 * Handles quoted fields containing commas.
 */
export function parseCSV(csv: string): string {
  const lines = csv.split("\n").filter(l => l.trim());
  if (lines.length === 0) return "";

  const headers = splitCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const values = splitCSVLine(line);
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
