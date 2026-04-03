/**
 * Embeddable Admin Panel — mount at any route in your app.
 *
 * @example
 * ```tsx
 * // Next.js App Router
 * import { AdminPanel } from "@bulwark-ai/gateway/admin";
 * export default function AdminPage() {
 *   return <AdminPanel apiBase="/api/bulwark-admin" />;
 * }
 *
 * // Express: serve as static HTML
 * app.use("/admin/ai", gateway.adminPanel());
 * ```
 */

import React, { useState, useEffect, useCallback } from "react";

interface AdminPanelProps {
  /** Base URL for admin API endpoints */
  apiBase: string;
  /** Custom fetch headers (e.g. auth tokens) */
  headers?: Record<string, string>;
}

interface Dashboard {
  requestsToday: number;
  requestsThisMonth: number;
  costToday: number;
  costThisMonth: number;
  activeUsers: number;
  topModels: { model: string; count: number; cost: number }[];
  topUsers: { userId: string; count: number; cost: number }[];
  costByTeam: { teamId: string; cost: number; tokens: number }[];
}

interface AuditEntry {
  id: string; action: string; user_id: string; team_id: string; model: string;
  input_tokens: number; output_tokens: number; cost_usd: number; duration_ms: number;
  pii_detections: number; timestamp: string;
}

type Tab = "dashboard" | "audit" | "knowledge" | "policies" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "audit", label: "Audit Log", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { id: "knowledge", label: "Knowledge Base", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
  { id: "policies", label: "Policies", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
  { id: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

const css = `
.bp-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0A2540; background: #F6F9FC; min-height: 100vh; display: flex; }
.bp-sidebar { width: 220px; background: #0A2540; padding: 20px 0; flex-shrink: 0; }
.bp-sidebar h1 { color: white; font-size: 16px; font-weight: 800; padding: 0 20px; margin: 0 0 24px; letter-spacing: -0.02em; }
.bp-nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 20px; font-size: 13px; font-weight: 500; color: rgba(255,255,255,.5); cursor: pointer; border: none; background: none; width: 100%; text-align: left; transition: all 150ms; }
.bp-nav-item:hover { color: rgba(255,255,255,.8); background: rgba(255,255,255,.05); }
.bp-nav-item.active { color: white; background: rgba(255,255,255,.1); border-right: 3px solid #635BFF; }
.bp-main { flex: 1; padding: 24px 32px; overflow-y: auto; }
.bp-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 18px 20px; }
.bp-grid { display: grid; gap: 12px; }
.bp-stat-label { font-size: 10px; font-weight: 600; color: #9CA3AF; text-transform: uppercase; letter-spacing: .06em; }
.bp-stat-value { font-size: 24px; font-weight: 800; font-family: 'SF Mono', 'Fira Code', monospace; margin-top: 4px; }
.bp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.bp-table th { text-align: left; padding: 8px 12px; font-size: 10px; font-weight: 600; color: #9CA3AF; text-transform: uppercase; letter-spacing: .06em; border-bottom: 2px solid #E5E7EB; }
.bp-table td { padding: 8px 12px; border-bottom: 1px solid #F3F4F6; }
.bp-table tr:hover { background: #F9FAFB; }
.bp-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; }
`;

function useFetch<T>(url: string, headers?: Record<string, string>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    fetch(url, { headers, credentials: "include" })
      .then(r => r.json()).then(d => setData(d)).catch(() => {}).finally(() => setLoading(false));
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}

const fmtCost = (n: number) => `$${n < 1 ? n.toFixed(4) : n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString()}`;
const fmtTokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`;

function DashboardTab({ apiBase, headers }: { apiBase: string; headers?: Record<string, string> }) {
  const { data, loading } = useFetch<Dashboard>(`${apiBase}/dashboard`, headers);
  if (loading || !data) return <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>Loading...</div>;

  return (
    <div>
      <div className="bp-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 20 }}>
        {[
          { label: "Requests Today", value: data.requestsToday, color: "#0A2540" },
          { label: "Requests This Month", value: data.requestsThisMonth, color: "#2563EB" },
          { label: "Cost Today", value: fmtCost(data.costToday), color: "#059669" },
          { label: "Cost This Month", value: fmtCost(data.costThisMonth), color: "#D97706" },
        ].map((s, i) => (
          <div key={i} className="bp-card">
            <div className="bp-stat-label">{s.label}</div>
            <div className="bp-stat-value" style={{ color: s.color }}>{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</div>
          </div>
        ))}
      </div>

      <div className="bp-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 20 }}>
        <div className="bp-card">
          <div className="bp-stat-label" style={{ marginBottom: 12 }}>Top Models</div>
          <table className="bp-table">
            <thead><tr><th>Model</th><th>Requests</th><th>Cost</th></tr></thead>
            <tbody>
              {data.topModels.map(m => (
                <tr key={m.model}><td style={{ fontWeight: 600 }}>{m.model}</td><td>{m.count}</td><td style={{ fontFamily: "monospace" }}>{fmtCost(m.cost)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bp-card">
          <div className="bp-stat-label" style={{ marginBottom: 12 }}>Top Users by Cost</div>
          <table className="bp-table">
            <thead><tr><th>User</th><th>Requests</th><th>Cost</th></tr></thead>
            <tbody>
              {data.topUsers.slice(0, 10).map(u => (
                <tr key={u.userId}><td style={{ fontWeight: 600 }}>{u.userId}</td><td>{u.count}</td><td style={{ fontFamily: "monospace" }}>{fmtCost(u.cost)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.costByTeam.length > 0 && (
        <div className="bp-card">
          <div className="bp-stat-label" style={{ marginBottom: 12 }}>Cost by Team</div>
          <table className="bp-table">
            <thead><tr><th>Team</th><th>Tokens</th><th>Cost</th></tr></thead>
            <tbody>
              {data.costByTeam.map(t => (
                <tr key={t.teamId}><td style={{ fontWeight: 600 }}>{t.teamId || "—"}</td><td>{fmtTokens(t.tokens)}</td><td style={{ fontFamily: "monospace" }}>{fmtCost(t.cost)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AuditTab({ apiBase, headers }: { apiBase: string; headers?: Record<string, string> }) {
  const [page, setPage] = useState(0);
  const { data, loading } = useFetch<{ entries: AuditEntry[]; total: number }>(`${apiBase}/audit?limit=50&offset=${page * 50}`, headers);

  const actionColor: Record<string, { bg: string; color: string }> = {
    chat: { bg: "#EFF6FF", color: "#2563EB" },
    pii_detected: { bg: "#FEF2F2", color: "#DC2626" },
    policy_block: { bg: "#FEF2F2", color: "#DC2626" },
    budget_exceeded: { bg: "#FFFBEB", color: "#D97706" },
  };

  return (
    <div className="bp-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="bp-stat-label">Audit Log</div>
        <span style={{ fontSize: 11, color: "#9CA3AF" }}>{data?.total || 0} entries</span>
      </div>
      {loading ? <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF" }}>Loading...</div> : (
        <>
          <table className="bp-table">
            <thead><tr><th>Time</th><th>Action</th><th>User</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Duration</th></tr></thead>
            <tbody>
              {(data?.entries || []).map(e => {
                const ac = actionColor[e.action] || { bg: "#F3F4F6", color: "#374151" };
                return (
                  <tr key={e.id}>
                    <td style={{ fontSize: 11, color: "#6B7280", whiteSpace: "nowrap" }}>{new Date(e.timestamp).toLocaleString()}</td>
                    <td><span className="bp-badge" style={{ background: ac.bg, color: ac.color }}>{e.action}</span></td>
                    <td>{e.user_id || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{e.model || "—"}</td>
                    <td style={{ fontFamily: "monospace" }}>{e.input_tokens || e.output_tokens ? `${fmtTokens(e.input_tokens || 0)}/${fmtTokens(e.output_tokens || 0)}` : "—"}</td>
                    <td style={{ fontFamily: "monospace" }}>{e.cost_usd ? fmtCost(e.cost_usd) : "—"}</td>
                    <td style={{ fontFamily: "monospace" }}>{e.duration_ms ? `${e.duration_ms}ms` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(data?.total || 0) > 50 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #E5E7EB", background: "white", fontSize: 12, cursor: "pointer" }}>Prev</button>
              <span style={{ fontSize: 12, color: "#9CA3AF", lineHeight: "28px" }}>Page {page + 1}</span>
              <button onClick={() => setPage(page + 1)} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #E5E7EB", background: "white", fontSize: 12, cursor: "pointer" }}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KnowledgeTab({ apiBase, headers }: { apiBase: string; headers?: Record<string, string> }) {
  const { data, loading } = useFetch<{ sources: { id: string; name: string; type: string; status: string; chunk_count: number; created_at: string }[] }>(`${apiBase}/knowledge`, headers);
  const statusColor: Record<string, { bg: string; color: string }> = {
    active: { bg: "#ECFDF5", color: "#059669" }, indexing: { bg: "#EFF6FF", color: "#2563EB" },
    pending: { bg: "#FFFBEB", color: "#D97706" }, error: { bg: "#FEF2F2", color: "#DC2626" },
  };

  return (
    <div className="bp-card">
      <div className="bp-stat-label" style={{ marginBottom: 12 }}>Knowledge Sources</div>
      {loading ? <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF" }}>Loading...</div> : (data?.sources || []).length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No knowledge sources yet. Use <code>gateway.rag.ingest()</code> to add documents.</div>
      ) : (
        <table className="bp-table">
          <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Chunks</th><th>Created</th></tr></thead>
          <tbody>
            {(data?.sources || []).map(s => {
              const sc = statusColor[s.status] || statusColor.pending;
              return (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td><span className="bp-badge" style={{ background: "#F3F4F6", color: "#374151" }}>{s.type}</span></td>
                  <td><span className="bp-badge" style={{ background: sc.bg, color: sc.color }}>{s.status}</span></td>
                  <td style={{ fontFamily: "monospace" }}>{s.chunk_count}</td>
                  <td style={{ fontSize: 11, color: "#6B7280" }}>{new Date(s.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PoliciesTab({ apiBase, headers }: { apiBase: string; headers?: Record<string, string> }) {
  const { data, loading } = useFetch<{ policies: { id: string; name: string; type: string; action: string; patterns?: string[] }[] }>(`${apiBase}/policies`, headers);

  return (
    <div className="bp-card">
      <div className="bp-stat-label" style={{ marginBottom: 12 }}>Content Policies</div>
      {loading ? <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF" }}>Loading...</div> : (data?.policies || []).length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No policies configured. Add policies via <code>gateway.policies.addPolicy()</code>.</div>
      ) : (
        <table className="bp-table">
          <thead><tr><th>Name</th><th>Type</th><th>Action</th><th>Patterns</th></tr></thead>
          <tbody>
            {(data?.policies || []).map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td><span className="bp-badge" style={{ background: "#EFF0FF", color: "#635BFF" }}>{p.type}</span></td>
                <td><span className="bp-badge" style={{ background: p.action === "block" ? "#FEF2F2" : "#FFFBEB", color: p.action === "block" ? "#DC2626" : "#D97706" }}>{p.action}</span></td>
                <td style={{ fontSize: 11, color: "#6B7280" }}>{p.patterns?.slice(0, 3).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AdminPanel({ apiBase, headers }: AdminPanelProps) {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <>
      <style>{css}</style>
      <div className="bp-root">
        <nav className="bp-sidebar">
          <h1>Bulwark AI</h1>
          {TABS.map(t => (
            <button key={t.id} className={`bp-nav-item ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
              {t.label}
            </button>
          ))}
        </nav>
        <main className="bp-main">
          {tab === "dashboard" && <DashboardTab apiBase={apiBase} headers={headers} />}
          {tab === "audit" && <AuditTab apiBase={apiBase} headers={headers} />}
          {tab === "knowledge" && <KnowledgeTab apiBase={apiBase} headers={headers} />}
          {tab === "policies" && <PoliciesTab apiBase={apiBase} headers={headers} />}
          {tab === "settings" && (
            <div className="bp-card" style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 14, color: "#9CA3AF" }}>Settings panel coming in v0.2</div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
