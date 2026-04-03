import React, { useState } from "react";
import { PageHeader, Table, Loading, Badge, card, mono, fmtCost, fmtTokens, useFetch } from "../components/shared";

interface Entry { id: string; action: string; user_id: string; team_id: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number; duration_ms: number; pii_detections: number; timestamp: string; }

const ACTION_COLORS: Record<string, { bg: string; color: string }> = {
  chat: { bg: "#EFF6FF", color: "#2563EB" }, pii_detected: { bg: "#FEF2F2", color: "#DC2626" },
  policy_block: { bg: "#FEF2F2", color: "#DC2626" }, budget_exceeded: { bg: "#FFFBEB", color: "#D97706" },
};

export function AuditPage({ apiBase }: { apiBase: string }) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const { data, loading } = useFetch<{ entries: Entry[]; total: number }>(`${apiBase}/audit?limit=50&offset=${page * 50}${filter ? `&action=${filter}` : ""}`);

  return (
    <div>
      <PageHeader title="Audit Log" subtitle={`${data?.total || 0} total entries`} action={
        <div style={{ display: "flex", gap: 4 }}>
          {["", "chat", "pii_detected", "policy_block", "budget_exceeded"].map(f => (
            <button key={f} onClick={() => { setFilter(f); setPage(0); }} style={{ padding: "5px 12px", borderRadius: 7, fontSize: 11, fontWeight: 600, border: filter === f ? "1.5px solid #0A2540" : "1px solid #E5E7EB", background: filter === f ? "#0A2540" : "white", color: filter === f ? "white" : "#6B7280", cursor: "pointer", fontFamily: "inherit" }}>{f || "All"}</button>
          ))}
        </div>
      } />
      <div style={card}>
        {loading ? <Loading /> : (
          <>
            <Table headers={["Time", "Action", "User", "Model", "Tokens", "Cost", "Duration"]}>
              {(data?.entries || []).map(e => {
                const ac = ACTION_COLORS[e.action] || { bg: "#F3F4F6", color: "#374151" };
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "8px 12px", fontSize: 11, color: "#6B7280", whiteSpace: "nowrap" }}>{new Date(e.timestamp).toLocaleString()}</td>
                    <td style={{ padding: "8px 12px" }}><Badge color={ac.color} bg={ac.bg}>{e.action}</Badge></td>
                    <td style={{ padding: "8px 12px", fontSize: 12 }}>{e.user_id || "—"}</td>
                    <td style={{ padding: "8px 12px", ...mono, fontSize: 11 }}>{e.model || "—"}</td>
                    <td style={{ padding: "8px 12px", ...mono, fontSize: 11 }}>{e.input_tokens ? `${fmtTokens(e.input_tokens)}/${fmtTokens(e.output_tokens)}` : "—"}</td>
                    <td style={{ padding: "8px 12px", ...mono, fontSize: 11, color: "#059669" }}>{e.cost_usd ? fmtCost(e.cost_usd) : "—"}</td>
                    <td style={{ padding: "8px 12px", ...mono, fontSize: 11 }}>{e.duration_ms ? `${e.duration_ms}ms` : "—"}</td>
                  </tr>
                );
              })}
            </Table>
            {(data?.total || 0) > 50 && (
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 14 }}>
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "white", fontSize: 12, cursor: "pointer" }}>Prev</button>
                <span style={{ fontSize: 12, color: "#9CA3AF", lineHeight: "30px" }}>Page {page + 1}</span>
                <button onClick={() => setPage(page + 1)} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "white", fontSize: 12, cursor: "pointer" }}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
