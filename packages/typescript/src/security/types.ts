export interface PIIConfig {
  enabled: boolean;
  /** Action when PII detected: "block" rejects request, "redact" masks PII, "warn" logs but allows */
  action?: "block" | "redact" | "warn";
  /** PII types to detect */
  types?: PIIType[];
  /** Custom regex patterns */
  customPatterns?: { name: string; pattern: string; action?: "block" | "redact" | "warn" }[];
}

export type PIIType =
  | "email" | "phone" | "ssn" | "credit_card" | "iban"
  | "ip_address" | "passport" | "drivers_license"
  | "date_of_birth" | "address" | "name"
  | "vat_number" | "national_id" | "medical_id";

export interface PIIMatch {
  type: PIIType | string;
  value: string;
  redacted: string;
  start: number;
  end: number;
}

export interface ContentPolicy {
  /** Unique policy ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Policy type */
  type: "topic_restriction" | "keyword_block" | "regex_block" | "max_tokens";
  /** Keywords or patterns to match */
  patterns?: string[];
  /** Regex pattern */
  regex?: string;
  /** Max tokens (for max_tokens type) */
  maxTokens?: number;
  /** Action when violated */
  action: "block" | "warn";
  /** Apply to specific teams/users only (empty = all) */
  applyTo?: { teams?: string[]; users?: string[] };
  /** Tenant scope (multi-tenant mode) */
  tenantId?: string;
}
