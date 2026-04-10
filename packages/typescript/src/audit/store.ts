import { v4 as uuid } from "uuid";
import type { AuditEntry, AuditStore, AuditQuery } from "./types";
import type { Database } from "../database";

export function createAuditStore(db: Database): AuditStore {
  return {
    async log(entry): Promise<string> {
      const id = uuid();
      db.run(
        `INSERT INTO bulwark_audit (id, tenant_id, user_id, team_id, action, model, provider, input_tokens, output_tokens, cost_usd, duration_ms, pii_detections, policy_violations, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          id,
          entry.tenantId || null,
          entry.userId || null,
          entry.teamId || null,
          entry.action,
          entry.model || null,
          entry.provider || null,
          entry.inputTokens || null,
          entry.outputTokens || null,
          entry.costUsd || null,
          entry.durationMs || null,
          entry.piiDetections || null,
          entry.policyViolations ? JSON.stringify(entry.policyViolations) : null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        ]
      );
      return id;
    },

    async query(filters: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }> {
      let where = "WHERE 1=1";
      const params: unknown[] = [];

      if (filters.tenantId) { where += " AND tenant_id = ?"; params.push(filters.tenantId); }
      if (filters.userId) { where += " AND user_id = ?"; params.push(filters.userId); }
      if (filters.teamId) { where += " AND team_id = ?"; params.push(filters.teamId); }
      if (filters.action) { where += " AND action = ?"; params.push(filters.action); }
      const isoDateRe = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/;
      if (filters.from && isoDateRe.test(filters.from)) { where += " AND timestamp >= ?"; params.push(filters.from); }
      if (filters.to && isoDateRe.test(filters.to)) { where += " AND timestamp <= ?"; params.push(filters.to); }

      const totalRow = await db.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM bulwark_audit ${where}`, params);
      const total = totalRow?.c || 0;

      const limit = filters.limit || 50;
      const offset = filters.offset || 0;
      const entries = await db.queryAll<AuditEntry>(
        `SELECT * FROM bulwark_audit ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      return { entries, total };
    },
  };
}
