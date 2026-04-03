export interface AuditEntry {
  id: string;
  tenantId?: string;
  userId?: string;
  teamId?: string;
  action: "chat" | "embed" | "search" | "upload" | "policy_block" | "pii_detected" | "budget_exceeded" | "login";
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs?: number;
  piiDetections?: number;
  policyViolations?: string[];
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface AuditStore {
  log(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<string>;
  query(filters: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }>;
}

export interface AuditQuery {
  tenantId?: string;
  userId?: string;
  teamId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}
