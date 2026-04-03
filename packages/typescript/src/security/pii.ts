import type { PIIConfig, PIIMatch, PIIType } from "./types";

/** Built-in PII patterns — regex-based, no ML dependencies */
const PII_PATTERNS: Record<PIIType, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d[ -]*?){13,19}\b/g,
  iban: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  passport: /\b[A-Z]{1,2}\d{6,9}\b/g,
  drivers_license: /\b[A-Z]{1,2}\d{5,8}\b/g,
  date_of_birth: /\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g,
  address: /\b\d{1,5}\s+\w+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Circle|Cir|gatvė|g\.|pr\.|al\.)\b/gi,
  name: /\b[A-ZÄÖÜŠŽČĘĖĮŪŲ][a-zäöüšžčęėįūų]+\s+[A-ZÄÖÜŠŽČĘĖĮŪŲ][a-zäöüšžčęėįūų]+\b/g,
  // EU-specific
  vat_number: /\b[A-Z]{2}\d{8,12}\b/g,
  national_id: /\b\d{6,11}[-/]?\d{0,4}\b/g, // Generic — covers most EU national ID formats
  medical_id: /\b(?:NHS|EHIC|SVN|AMM)[-\s]?\d{6,12}\b/gi,
};

/** Luhn algorithm — validates credit card numbers */
function luhnCheck(num: string): boolean {
  const digits = num.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || digits.length < 13) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export interface ScanResult {
  text: string;
  matches: PIIMatch[];
  blocked: boolean;
  redacted: boolean;
}

export class PIIDetector {
  private _config: PIIConfig;
  private activeTypes: PIIType[];

  constructor(config: PIIConfig) {
    this._config = config;
    this.activeTypes = config.types || ["email", "phone", "ssn", "credit_card", "iban"];
  }

  /** Whether PII detection is enabled */
  get config(): PIIConfig { return this._config; }

  /** Scan text for PII. Returns matches and optionally redacted text. */
  scan(text: string): ScanResult {
    if (!this._config.enabled) return { text, matches: [], blocked: false, redacted: false };

    const matches: PIIMatch[] = [];

    // Built-in patterns
    for (const type of this.activeTypes) {
      const pattern = PII_PATTERNS[type];
      if (!pattern) continue;
      // Reset regex state
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        // Validate credit card numbers with Luhn algorithm
        if (type === "credit_card" && !luhnCheck(match[0])) continue;
        matches.push({
          type,
          value: "[REDACTED]", // SECURITY: Never store raw PII values in match objects
          redacted: `[${type.toUpperCase()}]`,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }

    // Custom patterns — validated at construction time, safe patterns only
    if (this._config.customPatterns) {
      for (const custom of this._config.customPatterns) {
        try {
          // Reject patterns with known ReDoS structures: nested quantifiers like (a+)+, (a*)*
          if (/\([^)]*[+*][^)]*\)[+*]/.test(custom.pattern)) continue;
          // Reject patterns with excessive backtracking potential
          if (/(\.\*){3,}/.test(custom.pattern)) continue;

          const regex = new RegExp(custom.pattern, "gi");
          let match: RegExpExecArray | null;
          let count = 0;
          while ((match = regex.exec(text)) !== null) {
            if (++count > 100) break; // max 100 matches per pattern
            if (match[0].length === 0) { regex.lastIndex++; continue; }
            matches.push({
              type: custom.name as PIIType,
              value: "[REDACTED]",
              redacted: `[${custom.name.toUpperCase()}]`,
              start: match.index,
              end: match.index + match[0].length,
            });
          }
        } catch {
          // Invalid regex — skip silently
        }
      }
    }

    if (matches.length === 0) return { text, matches: [], blocked: false, redacted: false };

    const action = this._config.action || "warn";

    if (action === "block") {
      return { text, matches, blocked: true, redacted: false };
    }

    if (action === "redact") {
      // Apply redactions from end to start to preserve indices
      let redactedText = text;
      const sorted = [...matches].sort((a, b) => b.start - a.start);
      for (const m of sorted) {
        redactedText = redactedText.slice(0, m.start) + m.redacted + redactedText.slice(m.end);
      }
      return { text: redactedText, matches, blocked: false, redacted: true };
    }

    // warn — return matches but don't modify text
    return { text, matches, blocked: false, redacted: false };
  }
}
